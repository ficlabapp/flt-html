"use strict";

import * as FLT from "@ficlabapp/flt";
import { default as Domino } from "domino";
import { default as pretty } from "pretty";
import { default as serializer } from "xmlserializer";

// embedded stylesheet
let style = `
    .underline { text-decoration: underline; }
    .strikeout { text-decoration: line-through; }
    .monospace { font-family: monospace; }
    .align-left { text-align: left; }
    .align-center { text-align: center; }
    .align-right { text-align: right; }
    a.to-note { vertical-align: super; font-size: 0.5em; }
`;

// alignment class table
let alignClasses = {
    [FLT.Constants.ALIGN_LEFT]: "align-left",
    [FLT.Constants.ALIGN_CENTER]: "align-center",
    [FLT.Constants.ALIGN_RIGHT]: "align-right",
};

/**
 * Plugin to render FLT as HTML
 *
 * @since 1.0.0
 */
export class HTMLRendererPlugin extends FLT.Plugin {
    /**
     * Register plugin
     *
     * @since 1.0.0
     *
     * @return string[]
     */
    static _register() {
        return ["toHTML", "toHTMLDOM"];
    }

    /**
     * Render to HTML
     *
     * @since 1.0.0
     *
     * @param object userOptions User options
     * @return string
     */
    static toHTML(userOptions = {}) {
        let document = HTMLRendererPlugin.toHTMLDOM.call(this, userOptions);
        let bodyOnly = userOptions.hasOwnProperty("bodyOnly") ? userOptions.bodyOnly : false;

        if (bodyOnly) return pretty(serializer.serializeToString(document.body));
        else return `<!DOCTYPE html>\n${pretty(serializer.serializeToString(document))}`;
    }

    /**
     * Render to HTML DOM
     *
     * @since 1.2.0
     *
     * @param object userOptions User options
     * @return HTMLDocument
     */
    static toHTMLDOM(userOptions = {}) {
        // options
        let options = {
            bodyOnly: false, // whether to return just the body
            insertHeading: true, // whether to insert an h1 for the document title
            bodyClass: [], // classes to apply to the body element
            stylesheet: [], // external stylesheet URLs to include
        };
        for (let i in options) {
            if (userOptions.hasOwnProperty(i)) options[i] = userOptions[i];
        }

        // document setup
        let document = Domino.createDOMImplementation().createHTMLDocument();
        document.documentElement.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        let metaEl = document.head.appendChild(document.createElement("meta"));
        metaEl.setAttribute("http-equiv", "Content-Type");
        metaEl.setAttribute("content", "text/html; charset=utf-8");

        // source metadata
        if (this.features.DCMETA) {
            this.getDC("date").forEach((s) =>
                document.head.appendChild(document.createComment(` Date: ${s} `))
            );
            this.getDC("source").forEach((s) =>
                document.head.appendChild(document.createComment(` Source: ${s} `))
            );
        }

        // styles
        let styleEl = document.head.appendChild(document.createElement("style"));
        styleEl.textContent = style;
        if (options.stylesheet.length)
            for (let url of options.stylesheet) {
                let el = document.head.appendChild(document.createElement("link"));
                el.setAttribute("rel", "stylesheet");
                el.setAttribute("type", "text/css");
                el.setAttribute("href", url);
            }

        // other metadata
        HTMLRendererPlugin.applyMetadata.call(this, document);

        // body
        if (options.bodyClass.length) document.body.classList.add(...options.bodyClass);
        if (options.insertHeading && this.features.DCMETA) {
            let title = this.getDC("title").join(", ");
            if (title) {
                let h1 = document.body.appendChild(document.createElement("h1"));
                h1.setAttribute("id", "title");
                h1.textContent = title;
            }
        }

        // render context
        let noteIndex = 1,
            link = null,
            hint = null,
            blob = null,
            sect = document.body.appendChild(document.createElement("section")),
            dest = FLT.Constants.D_BODY,
            reset = () => {
                link = null;
                hint = null;
            },
            destEl = () => {
                // get the current destination element
                switch (dest) {
                    case FLT.Constants.D_BODY: {
                        let p = sect.lastElementChild;
                        if (!p || !(p instanceof Domino.impl.HTMLParagraphElement))
                            p = sect.appendChild(document.createElement("p"));
                        return p;
                    }
                    case FLT.Constants.D_NOTE:
                        // notAnElement is used here because domino doesn't return an iterable
                        // unless there are multiple queries provided - this is a workaround.
                        let note = [...sect.querySelectorAll("aside, notAnElement")].slice(-1)[0];
                        return [...note.querySelectorAll("p, notAnElement")].slice(-1)[0];
                    case FLT.Constants.D_CELL: {
                        let cell = [...sect.querySelectorAll("th, td")].slice(-1)[0];
                        let cont = [...cell.querySelectorAll("aside, p")].slice(-1)[0];
                        return cont || cell;
                    }
                    case FLT.Constants.D_HEAD: {
                        let h = sect.lastElementChild;
                        if (
                            !h ||
                            !(h instanceof Domino.impl.HTMLHeadingElement) ||
                            h.tagName !== "H2"
                        )
                            h = sect.appendChild(document.createElement("h2"));
                        return h;
                    }
                    default:
                        throw new FLT.Error.FLTError(`Unknown render destination ${dest}`);
                }
            };

        // iterate all typed & text lines, but *not* metadata lines
        for (let line of this.lines) {
            if (line.reset) reset(); // reset flag must be handled first, for all types
            if (line instanceof FLT.TypeLine) {
                // typed lines
                switch (line.lineType) {
                    // start a new section
                    case FLT.Constants.T_SECTION:
                        link = null;
                        dest = FLT.Constants.D_BODY; // reset target to body when a new section is created
                        if (!sect.hasChildNodes()) sect.parentNode.removeChild(sect);
                        sect = document.body.appendChild(document.createElement("section"));
                        if (line.align in alignClasses)
                            sect.classList.add(alignClasses[line.align]);
                        if (line.break && sect.parentElement.querySelector("section") !== sect) {
                            let hr = document.createElement("hr");
                            sect.insertAdjacentElement("beforeBegin", hr);
                        }
                        break;
                    // start a new paragraph
                    case FLT.Constants.T_PARAGRAPH: {
                        link = null;
                        let cont = destEl().closest("aside, td, th, section");
                        let p = cont.appendChild(document.createElement("p"));
                        if (line.align in alignClasses) p.classList.add(alignClasses[line.align]);
                        break;
                    }
                    // set the tooltip content
                    case FLT.Constants.T_HINT:
                        hint = line.content;
                        break;
                    // create a link
                    case FLT.Constants.T_LINK: {
                        link = destEl().appendChild(document.createElement("a"));
                        link.setAttribute("href", line.content);
                        if (hint) link.setAttribute("title", hint), (hint = null);
                        break;
                    }
                    // create an anchor
                    case FLT.Constants.T_ANCHOR: {
                        let a = destEl().appendChild(document.createElement("a"));
                        a.setAttribute("name", line.content);
                        break;
                    }
                    // set the blob content
                    case FLT.Constants.T_BLOB:
                        blob = { type: line.mediaType, data: line.data };
                        break;
                    // create an image
                    case FLT.Constants.T_IMAGE: {
                        let img = destEl().appendChild(document.createElement("img"));
                        if (line.content) img.setAttribute("src", line.content);
                        else if (!blob) throw new FLT.Error.FLTError("No image content available");
                        else img.setAttribute("src", `data:${blob.type};base64,${blob.data}`);
                        if (hint) img.setAttribute("title", hint), (hint = null);
                        break;
                    }
                    // create a table
                    case FLT.Constants.T_TABLE: {
                        let table = sect.appendChild(document.createElement("table"));
                        table.fltColumns = line.content;
                        break;
                    }
                    // set the render destination
                    case FLT.Constants.T_DESTINATION: {
                        link = null;
                        if (line.destination === FLT.Constants.D_NOTE) {
                            let a = destEl().appendChild(document.createElement("a"));
                            a.setAttribute("name", `flt-note-return-${noteIndex}`);
                            a.setAttribute("href", `#flt-note-${noteIndex}`);
                            a.classList.add("to-note");
                            a.textContent = noteIndex;
                            let note = sect.appendChild(document.createElement("aside"));
                            a = note.appendChild(document.createElement("a"));
                            a.setAttribute("name", `flt-note-${noteIndex}`);
                            a.setAttribute("href", `#flt-note-return-${noteIndex}`);
                            a.classList.add("from-note");
                            noteIndex++;
                            note.appendChild(document.createElement("p"));
                        } else if (line.destination === FLT.Constants.D_CELL) {
                            let table = sect.querySelector("table:last-of-type");
                            if (!table)
                                throw new FLT.Error.FLTError(
                                    "Cannot set destination to D_CELL when no table is defined"
                                );
                            let cellCount = table.querySelectorAll("th, td").length;
                            let row = table.querySelector("tr:last-of-type");
                            if (!row || !(BigInt(cellCount) % BigInt(table.fltColumns)))
                                row = table.appendChild(document.createElement("tr"));
                            row.appendChild(document.createElement(line.header ? "th" : "td"));
                        } else if (line.destination === FLT.Constants.D_HEAD) {
                            sect = document.body.appendChild(document.createElement("section"));
                        }
                        dest = line.destination;
                        break;
                    }
                }
            } else if (line instanceof FLT.TextLine) {
                // formatted text
                // TODO optimise nesting
                let fragments = line.text.split(/\n/u);
                let out = destEl();
                if (link && out.contains(link)) out = link;
                if (line.italic) out = out.appendChild(document.createElement("em"));
                if (line.bold) out = out.appendChild(document.createElement("strong"));
                if (line.underline || line.strikeout || line.mono) {
                    out = out.appendChild(document.createElement("span"));
                    if (line.underline) out.classList.add("underline");
                    if (line.strikeout) out.classList.add("strikeout");
                    if (line.mono) out.classList.add("monospace");
                }
                if (line.supertext) out = out.appendChild(document.createElement("sup"));
                if (line.subtext) out = out.appendChild(document.createElement("sub"));

                do {
                    out.appendChild(document.createTextNode(fragments.shift()));
                    if (fragments.length) out.appendChild(document.createElement("br"));
                } while (fragments.length);
            }
        }

        // cleanup
        document.querySelectorAll("section, p").forEach((el) => {
            if (!el.hasChildNodes()) el.parentNode.removeChild(el);
        });

        return document;
    }

    /**
     * Render document metadata into the DOM
     *
     * @since 1.0.0
     *
     * @return void
     */
    static applyMetadata(document) {
        if (!this.features.DCMETA) return; // not applicable if DC is disabled

        // title tag
        let title = this.getDC("title").join(", ");
        if (title) {
            let titleEl = document.head.appendChild(document.createElement("title"));
            titleEl.textContent = title;
        }

        // dublin core -> opengraph
        let og = (term, value) => {
            let el = document.head.appendChild(document.createElement("meta"));
            el.setAttribute("property", `og:${term}`);
            el.setAttribute("content", value);
        };
        og("type", "article");
        let terms = {
            title: { name: "title", merge: true },
            description: { name: "description", merge: true },
            creator: { name: "article:author", merge: false },
            subject: { name: "article:tag", merge: false },
            date: { name: "article:published_time", merge: false },
        };
        for (let term in terms) {
            let value = this.getDC(term);
            if (!value) continue;
            if (terms[term].merge) value = [value.join(", ")];
            value.forEach((v) => og(terms[term].name, v));
        }
    }
}
