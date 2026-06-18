import { AnkiConnectNote } from './interfaces/note-interface'
import { basename, extname } from 'path'
import { Converter } from 'showdown'
import { CachedMetadata } from 'obsidian'
import * as c from './constants'
import hljs from 'highlight.js'

const ANKI_MATH_REGEXP:RegExp = /(\\\[[\s\S]*?\\\])|(\\\([\s\S]*?\\\))/g
const HIGHLIGHT_REGEXP:RegExp = /==(.*?)==/g
// Matches only the header line of an Obsidian callout. Body lines are
// resolved separately by _censor_callouts to support lazy continuation
// (lines without '>' that still belong to the callout per CommonMark).
// Group 1 = type, Group 2 = folding marker (+/-), Group 3 = title.
const CALLOUT_HEADER_REGEXP:RegExp = /^> *\[!([a-zA-Z0-9_-]+)\]([+-]?)(.*)$/

const MATH_REPLACE:string = "OBSTOANKIMATH"
const INLINE_CODE_REPLACE:string = "OBSTOANKICODEINLINE"
const DISPLAY_CODE_REPLACE:string = "OBSTOANKICODEDISPLAY"
const CALLOUT_REPLACE:string = "OBSTOANKICALLOUT"

// Border colour per Obsidian callout type. Types not listed fall back to
// CALLOUT_DEFAULT_BORDER. Background stays grey (#f5f5f5) for all types.
const CALLOUT_BORDER_COLORS: Record<string, string> = {
	quote: '#555',
	important: '#2e7d32',
	note: '#1565c0',
	question: '#c62828',
}
const CALLOUT_DEFAULT_BORDER: string = '#000'
const CALLOUT_QUOTE_FONT_URL: string = 'https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;500;600&display=swap'

interface CalloutMatch {
	type: string
	title: string
	raw_body: string
}

const CLOZE_REGEXP:RegExp = /(?:(?<!{){(?:c?(\d+)[:|])?(?!{))((?:[^\n][\n]?)+?)(?:(?<!})}(?!}))/g

const IMAGE_EXTS: string[] = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".tiff"]
const AUDIO_EXTS: string[] = [".wav", ".m4a", ".flac", ".mp3", ".wma", ".aac", ".webm"]

const PARA_OPEN:string = "<p>"
const PARA_CLOSE:string = "</p>"

let cloze_unset_num: number = 1

let converter: Converter = new Converter({
	simplifiedAutoLink: true,
	literalMidWordUnderscores: true,
	tables: true, tasklists: true,
	simpleLineBreaks: true,
	requireSpaceBeforeHeadingText: true
})

function escapeHtml(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

export class FormatConverter {

	file_cache: CachedMetadata
	vault_name: string
	detectedMedia: Set<string>

	constructor(file_cache: CachedMetadata, vault_name: string) {
		this.vault_name = vault_name
		this.file_cache = file_cache
		this.detectedMedia = new Set()
	}

	getUrlFromLink(link: string): string {
        return "obsidian://open?vault=" + encodeURIComponent(this.vault_name) + String.raw`&file=` + encodeURIComponent(link)
    }

	format_note_with_url(note: AnkiConnectNote, url: string, field: string): void {
		note.fields[field] += '<br><a href="' + url + '" class="obsidian-link">Obsidian</a>'
	}

	format_note_with_frozen_fields(note: AnkiConnectNote, frozen_fields_dict: Record<string, Record<string, string>>): void {
		for (let field in note.fields) {
			note.fields[field] += frozen_fields_dict[note.modelName][field]
		}
	}

	obsidian_to_anki_math(note_text: string): string {
		return note_text.replace(
				c.OBS_DISPLAY_MATH_REGEXP, "\\[$1\\]"
		).replace(
			c.OBS_INLINE_MATH_REGEXP,
			"\\($1\\)"
		)
	}

	cloze_repl(_1: string, match_id: string, match_content: string): string {
		if (match_id == undefined) {
			let result = "{{c" + cloze_unset_num.toString() + "::" + match_content + "}}"
			cloze_unset_num += 1
			return result
		}
		let result = "{{c" + match_id + "::" + match_content + "}}"
		return result
	}

	curly_to_cloze(text: string): string {
		/*Change text in curly brackets to Anki-formatted cloze.*/
		text = text.replace(CLOZE_REGEXP, this.cloze_repl)
		cloze_unset_num = 1
		return text
	}

	getAndFormatMedias(note_text: string): string {
		if (!(this.file_cache.hasOwnProperty("embeds"))) {
			return note_text
		}
		for (let embed of this.file_cache.embeds) {
			if (note_text.includes(embed.original)) {
				this.detectedMedia.add(embed.link)
				if (AUDIO_EXTS.includes(extname(embed.link))) {
					note_text = note_text.replace(new RegExp(c.escapeRegex(embed.original), "g"), "[sound:" + basename(embed.link) + "]")
				} else if (IMAGE_EXTS.includes(extname(embed.link))) {
					note_text = note_text.replace(
						new RegExp(c.escapeRegex(embed.original), "g"),
						'<img src="' + basename(embed.link) + '" alt="' + embed.displayText + '" style="border:1px solid #ccc;border-radius:4px;">'
					)
				} else {
					console.warn("Unsupported extension: ", extname(embed.link))
				}
			}
		}
		return note_text
	}

	formatLinks(note_text: string): string {
		if (!(this.file_cache.hasOwnProperty("links"))) {
			return note_text
		}
		for (let link of this.file_cache.links) {
			note_text = note_text.replace(new RegExp(c.escapeRegex(link.original), "g"), '<a href="' + this.getUrlFromLink(link.link) + '">' + link.displayText + "</a>")
		}
		return note_text
	}

	censor(note_text: string, regexp: RegExp, mask: string): [string, string[]] {
		/*Take note_text and replace every match of regexp with mask, simultaneously adding it to a string array*/
		let matches: string[] = []
		for (let match of note_text.matchAll(regexp)) {
			matches.push(match[0])
		}
		return [note_text.replace(regexp, mask), matches]
	}

	decensor(note_text: string, mask:string, replacements: string[], escape: boolean): string {
		for (let replacement of replacements) {
			note_text = note_text.replace(
				mask, escape ? escapeHtml(replacement) : replacement
			)
		}
		return note_text
	}

	highlight_code_block(code: string, lang: string): string {
		/*Highlight code using highlight.js and return HTML.*/
		let highlighted: string
		if (lang && hljs.getLanguage(lang)) {
			highlighted = hljs.highlight(code, { language: lang }).value
		} else {
			highlighted = hljs.highlightAuto(code).value
		}
		const langClass = lang ? `${lang} language-${lang}` : ''
		return `<pre><code class="hljs ${langClass}">${highlighted}</code></pre>`
	}

	censor_callouts(note_text: string): [string, CalloutMatch[]] {
		/*Replace each Obsidian callout with CALLOUT_REPLACE and return the
		surviving callouts. Body extent is resolved by walking lines after
		the header so lazy continuation lines (no '>' prefix but still part
		of the same blockquote paragraph, per CommonMark) are kept inside
		the callout, matching how Obsidian renders them.*/
		const lines: string[] = note_text.split('\n')
		const callouts: CalloutMatch[] = []
		const new_lines: string[] = []
		let i = 0
		const n = lines.length
		while (i < n) {
			const header = lines[i].match(CALLOUT_HEADER_REGEXP)
			if (!header) {
				new_lines.push(lines[i])
				i += 1
				continue
			}
			const callout_type: string = (header[1] || '').toLowerCase()
			const title: string = (header[3] || '').trim()
			const body_lines: string[] = []
			i += 1
			let prev_content: boolean = true  // header lets the next line be a lazy continuation
			while (i < n) {
				const line = lines[i]
				if (line.startsWith('>')) {
					body_lines.push(line)
					i += 1
					prev_content = true
				} else if (line.trim() === '') {
					// Blank line: callout only continues if the next non-blank
					// line is quoted ('>'); otherwise the callout has ended.
					let j = i + 1
					while (j < n && lines[j].trim() === '') {
						j += 1
					}
					if (j < n && lines[j].startsWith('>')) {
						body_lines.push(...lines.slice(i, j + 1))
						i = j + 1
						prev_content = true
					} else {
						break
					}
				} else {
					// Non-'>', non-blank line: a lazy continuation only while
					// it directly continues callout content.
					if (prev_content) {
						body_lines.push(line)
						i += 1
					} else {
						break
					}
				}
			}
			callouts.push({
				type: callout_type,
				title: title,
				raw_body: body_lines.join('\n'),
			})
			new_lines.push(CALLOUT_REPLACE)
		}
		return [new_lines.join('\n'), callouts]
	}

	format(note_text: string, cloze: boolean, highlights_to_cloze: boolean): string {
		const add_highlight_css: boolean = note_text.match(c.OBS_DISPLAY_CODE_REGEXP) || note_text.match(c.OBS_CODE_REGEXP) ? true : false;
		// Censor callouts FIRST so their content (code blocks, math, '>')
		// is not touched by the outer pass. Each callout is rendered
		// recursively at the end so its inner markdown formats normally.
		let callout_matches: CalloutMatch[]
		;[note_text, callout_matches] = this.censor_callouts(note_text)
		// Censor code blocks FIRST so $ inside code is not treated as math
		let inline_code_matches: string[]
		let display_code_matches: string[]
		[note_text, display_code_matches] = this.censor(note_text, c.OBS_DISPLAY_CODE_REGEXP, DISPLAY_CODE_REPLACE);
		[note_text, inline_code_matches] = this.censor(note_text, c.OBS_CODE_REGEXP, INLINE_CODE_REPLACE);
		// Now convert math (code blocks are already replaced with placeholders)
		note_text = this.obsidian_to_anki_math(note_text)
		//Extract the parts that are anki math
		let math_matches: string[]
		[note_text, math_matches] = this.censor(note_text, ANKI_MATH_REGEXP, MATH_REPLACE);
		if (cloze) {
			if (highlights_to_cloze) {
				note_text = note_text.replace(HIGHLIGHT_REGEXP, "{$1}")
			}
			note_text = this.curly_to_cloze(note_text)
		}
		note_text = this.getAndFormatMedias(note_text)
		note_text = this.formatLinks(note_text)
		//Special for formatting highlights now, but want to avoid any == in code
		note_text = note_text.replace(HIGHLIGHT_REGEXP, String.raw`<mark>$1</mark>`)
		note_text = this.decensor(note_text, DISPLAY_CODE_REPLACE, display_code_matches, false)
		note_text = this.decensor(note_text, INLINE_CODE_REPLACE, inline_code_matches, false)
		// Extract code blocks before markdown conversion to preserve them in lists
		const CODE_BLOCK_PLACEHOLDER = "OBSTOANKICODEBLOCKPLACEHOLDER"
		const code_blocks: Array<{lang: string, code: string}> = []
		let code_index = 0
		note_text = note_text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
			code_blocks.push({ lang: lang || '', code: code.trimEnd() })
			return CODE_BLOCK_PLACEHOLDER + (code_index++)
		})
		note_text = converter.makeHtml(note_text)
		note_text = note_text.replace(
			/<table>/g,
			'<table style="border-collapse: collapse; width: 100%;">'
		)
		note_text = note_text.replace(
			/<th>/g,
			'<th style="border: 1px solid #ccc; padding: 8px; text-align: left; background-color: #f2f2f2;">'
		)
		note_text = note_text.replace(
			/<td>/g,
			'<td style="border: 1px solid #ccc; padding: 8px;">'
		)
		// Replace placeholders with highlighted code blocks
		code_blocks.forEach((block, idx) => {
			const code_html = this.highlight_code_block(block.code, block.lang)
			note_text = note_text.replace(CODE_BLOCK_PLACEHOLDER + idx, code_html)
		})
		note_text = this.decensor(note_text, MATH_REPLACE, math_matches, true).trim()
		// Remove unnecessary paragraph tag
		if (note_text.startsWith(PARA_OPEN) && note_text.endsWith(PARA_CLOSE)) {
			note_text = note_text.slice(PARA_OPEN.length, -1 * PARA_CLOSE.length)
		}
		if (add_highlight_css) {
			note_text = c.CODE_HIGHLIGHT_CSS + note_text
		}
		// quote callouts use the Inconsolata font; load it once if any survive.
		if (callout_matches.some(cm => cm.type === 'quote')) {
			note_text = `<style>@import url('${CALLOUT_QUOTE_FONT_URL}');</style>` + note_text
		}
		for (const callout_match of callout_matches) {
			const callout_type: string = callout_match.type
			const raw_body: string = callout_match.raw_body
			// Strip one level of ">" quoting from each quoted body line so
			// that nested callouts (">> ...") become "> ..." and recurse
			// properly. Lazy continuation lines (no '>') are left untouched.
			const inner_md: string = raw_body.replace(/^> ?/gm, '').trim()
			let inner_html: string = this.format(inner_md, cloze, highlights_to_cloze)
			// Strip leading <style>...</style> added by the recursive call to avoid duplication.
			inner_html = inner_html.replace(/^<style>[\s\S]*?<\/style>/, '')
			const border_color: string = CALLOUT_BORDER_COLORS[callout_type] || CALLOUT_DEFAULT_BORDER
			const font_style: string = callout_type === 'quote' ? `font-family:'Inconsolata',monospace;` : ''
			const callout_html: string = `<div style="background-color:#f5f5f5;border:1px solid ${border_color};border-radius:4px;padding:10px;margin:8px 0;${font_style}">${inner_html}</div>`
			note_text = note_text.replace(CALLOUT_REPLACE, callout_html)
		}
		return note_text
	}




}
