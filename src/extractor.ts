
import * as vscode from 'vscode';

import { DOMParser, Element as XMLElement, Node as XMLNode } from '@xmldom/xmldom';

export interface AllowedValuesMap {
    [key: string]: string[] & { _noCustomInput?: boolean };
}

export interface RangeInfo {
    from: string;
    to: string;
    source: 'attributes' | 'child-elements';
}

export interface ExtractedValues {
    values: string[];
    hasRange: boolean;
    rangeInfo?: RangeInfo;
    isRestricted: boolean;
}


/**
 * Extracts a full CL (Command Language) command from a list of lines, starting from a given line index.
 * Handles line continuations indicated by trailing `+` or `-` characters, and ignores trailing comments.
 *
 * The function scans upwards to find the start of the command (handling continuations),
 * then concatenates all relevant lines, removing continuation characters and comments as needed.
 * For `+` continuations, leading whitespace on the next line is trimmed; for `-`, the next line is appended as-is.
 *
 *           const editor = vscode.window.activeTextEditor;
 *           if (editor) {
 *            const doc = editor.document;
 *            const currentLine = editor.selection.active.line;
 *            const cmdResult = extractFullCLCmd(doc, currentLine);
 *           }
 * @param doc - The active text editor's document
 * @param currentLine - The index of the line where the command extraction should start.
 * @returns An object containing:
 *   - `command`: The extracted full command as a single string.
 *   - `startLine`: The index of the first line of the command.
 *   - `endLine`: The index of the last line of the command.
 */

export function collectCLCmd(
  editor: vscode.TextEditor
): { command: string; startLine: number; endLine: number } {

    const doc = editor.document;
    const currentLine = editor.selection.active.line;

  let startLine = currentLine;
  let endLine = currentLine;

  // Scan backward for start of command
  while (startLine > 0) {
    const prevLineText = doc.lineAt(startLine - 1).text;
    const codePart = prevLineText.replace(/\/\*.*\*\//g, '').trimEnd();
    if (codePart.endsWith('+') || codePart.endsWith('-')) {
      startLine--;
    } else {
      break;
    }
  }

  let command = '';
  let lineIndex = startLine;
  const totalLines = doc.lineCount;

  while (lineIndex < totalLines) {
    let line = doc.lineAt(lineIndex).text;
    let codePart = line;
    const commentIdx = line.indexOf('/*');
    if (commentIdx !== -1) {
      codePart = line.substring(0, commentIdx);
    }
    codePart = codePart.replace(/[ \t]+$/, '');

    let contChar = '';
    let lineContent = codePart;
    if (codePart.length > 0 && (codePart[codePart.length - 1] === '+' || codePart[codePart.length - 1] === '-')) {
      contChar = codePart[codePart.length - 1];
      lineContent = codePart.slice(0, -1);
    }

    if (contChar) {
      command += lineContent;
      endLine = lineIndex;
      // Prepare to concatenate the next line
      if (lineIndex + 1 >= totalLines) break;
      let nextLine = doc.lineAt(lineIndex + 1).text;
      let nextContent = nextLine;
      const nextCommentIdx = nextLine.indexOf('/*');
      if (nextCommentIdx !== -1) {
        nextContent = nextLine.substring(0, nextCommentIdx);
      }
      nextContent = nextContent.replace(/[ \t]+$/, '');

      // Check if the continuation line itself has a continuation character
      let nextHasCont = false;
      if (nextContent.length > 0 && (nextContent[nextContent.length - 1] === '+' || nextContent[nextContent.length - 1] === '-')) {
        nextHasCont = true;
        nextContent = nextContent.slice(0, -1);
      }

      if (contChar === '+') {
        let firstNonBlank = nextContent.search(/\S/);
        if (firstNonBlank === -1) firstNonBlank = nextContent.length;
        nextContent = nextContent.slice(firstNonBlank);
      }
      command += nextContent;
      lineIndex++;
      endLine = lineIndex;

      // Only continue if the continuation line itself has a continuation
      if (nextHasCont) {
        lineIndex++;
        continue;
      } else {
        break;
      }
    } else {
      command += lineContent;
      endLine = lineIndex;
      break;
    }
  }

  command = command.replace(/\s{2,}/g, ' ').trim();

  return { command, startLine, endLine };
}




/**
 * Extract all allowed values from a parameter element including Range, Values, SpcVal, SngVal
 */
export function extractAllowedValues(element: XMLElement): string[] {
    const vals: string[] = [];

    // ✅ Check for Range attributes FIRST (RangeMinVal/RangeMaxVal)
    const rangeMin = element.getAttribute("RangeMinVal");
    const rangeMax = element.getAttribute("RangeMaxVal");

    if (rangeMin !== null && rangeMax !== null) {
        // ✅ Use range metadata instead of individual values
        vals.push(`_RANGE_${rangeMin}_${rangeMax}`);
        console.log(`[clPrompter] Added range metadata ${rangeMin}-${rangeMax} for ${element.tagName} (from attributes)`);

        // ✅ Fix the parent hierarchy check with proper typing
        let current: XMLNode | null = element;
        while (current && (current as any).getAttribute) {
            const kwd = (current as any).getAttribute('Kwd');
            if (kwd) {
                console.log(`[clPrompter] *** FOUND RANGE IN ${kwd}: ${rangeMin}-${rangeMax} (from attributes) ***`);
                break;
            }
            current = current.parentNode;
        }
    }

    // ✅ Fix the getElementsByTagName calls
    const values = element.getElementsByTagName("Values");
    if (values.length > 0) {
        const valueElements = Array.from(values[0].getElementsByTagName("Value"));
        const extractedValues = valueElements
            .map(v => (v as any).getAttribute("Val") || (v as any).getAttribute("Value"))
            .filter(Boolean) as string[];
        vals.push(...extractedValues);
    }

    // ✅ Fix SpcVal processing
    const spcvals = element.getElementsByTagName("SpcVal");
    if (spcvals.length > 0) {
        const spcValueElements = Array.from(spcvals[0].getElementsByTagName("Value"));
        const extractedSpcValues = spcValueElements
            .map(v => (v as any).getAttribute("Val") || (v as any).getAttribute("Value"))
            .filter(Boolean) as string[];
        vals.push(...extractedSpcValues);
    }

    // ✅ Fix SngVal processing
    const sngvals = element.getElementsByTagName("SngVal");
    if (sngvals.length > 0) {
        const sngValueElements = Array.from(sngvals[0].getElementsByTagName("Value"));
        const extractedSngValues = sngValueElements
            .map(v => (v as any).getAttribute("Val") || (v as any).getAttribute("Value"))
            .filter(Boolean) as string[];
        vals.push(...extractedSngValues);
    }

    // ✅ Fix Range child elements
    const ranges = element.getElementsByTagName("Range");
    if (ranges.length > 0) {
        const range = ranges[0] as any;
        const from = range.getAttribute("From");
        const to = range.getAttribute("To");

        if (from !== null && to !== null) {
            vals.push(`_RANGE_${from}_${to}`);
            console.log(`[clPrompter] Added range metadata ${from}-${to} for ${element.tagName} (from child elements)`);
        }
    }

    return [...new Set(vals)]; // Remove duplicates
}

/**
 * Check if a parameter element is restricted (no custom input allowed)
 */
// ✅ Update around line 90
function isRestricted(element: XMLElement): boolean {
    const hasRange = element.getElementsByTagName("Range").length > 0;
    const hasSngval = element.getElementsByTagName("SngVal").length > 0;
    const hasSpcval = element.getElementsByTagName("SpcVal").length > 0;
    const hasValues = element.getElementsByTagName("Values").length > 0;

    return element.getAttribute("Rstd") === "Y" ||
        ((hasValues || hasRange) && !hasSngval && !hasSpcval);
}

/**
 * Process nested ELEM sub-elements and add them to the allowed values map
 */
// ✅ Fix around line 100
function processNestedElements(
    elem: XMLElement,
    elemName: string,
    allowedValsMap: AllowedValuesMap
): void {

    if (elem.getAttribute("Type") === "ELEM") {
        console.log(`[clPrompter] Processing nested ELEM: ${elemName}`);

        // OLD: const subElems = (elem as any).querySelectorAll(":scope > Elem");
        // NEW: Use getElementsByTagName and filter for direct children
        const allSubElems = elem.getElementsByTagName("Elem");
        const subElems = Array.from(allSubElems).filter(subElem => subElem.parentNode === elem);

        for (let se = 0; se < subElems.length; se++) {
            const subElem = subElems[se] as XMLElement;
            const subElemName = `${elemName}_SUB${se}`;

            const subElemVals = extractAllowedValues(subElem);

            if (subElemVals.length > 0) {
                allowedValsMap[subElemName] = subElemVals as any;

                if (isRestricted(subElem)) {
                    (allowedValsMap[subElemName] as any)._noCustomInput = true;
                }

                console.log(`[clPrompter] Added nested ELEM to allowedValsMap: ${subElemName}`, subElemVals);
            }
        }
    }
}

/**
 * Build the complete allowed values map from XML parameters
 */
// ✅ Fix the main function around line 130
export function buildAllowedValsMap(xmlContent: string): AllowedValuesMap {
    console.log('[clPrompter] Building allowed values map from XML');

    const allowedValsMap: AllowedValuesMap = {};

    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
    const parms = Array.from(xmlDoc.getElementsByTagName("Parm")) as XMLElement[];

    if (!parms.length) {
        console.warn('[clPrompter] No parameters found in XML');
        return allowedValsMap;
    }

    parms.forEach(parm => {
        const kwd = parm.getAttribute("Kwd");
        const type = parm.getAttribute("Type");
        const constant = parm.getAttribute("Constant");

        if (!kwd) {
            console.warn('[clPrompter] Parameter missing Kwd attribute, skipping');
            return;
        }

        // ✅ Skip parameters with Constant attribute
        if (constant) {
            console.log(`[clPrompter] Skipping CONSTANT parameter in allowedValsMap: ${kwd} (Constant=${constant})`);
            return;
        }

        // ✅ Skip NULL parameters (handle both "NULL" and "Null" cases)
        if (type && type.toUpperCase() === "NULL") {
            console.log(`[clPrompter] Skipping NULL parameter in allowedValsMap: ${kwd} (Type=${type})`);
            return;
        }

        // --- Process parameter itself ---
        const parmVals = extractAllowedValues(parm);
        if (parmVals.length > 0) {
            allowedValsMap[kwd] = parmVals as any;

            if (isRestricted(parm)) {
                (allowedValsMap[kwd] as any)._noCustomInput = true;
            }
        }

        // --- Process ELEM elements ---
        const allElems = parm.getElementsByTagName("Elem");
        const elems = Array.from(allElems).filter(elem => elem.parentNode === parm);
        console.log(`[clPrompter] Processing ${elems.length} DIRECT Elem elements for ${kwd}`);

        // ✅ Get parameter-level SngVal for ELEM parameters
        let parmSngVal = null;
        if (parm.getAttribute("Type") === "ELEM") {
            const sngVals = parm.getElementsByTagName("SngVal");
            // Find direct child SngVal (not nested)
            for (let i = 0; i < sngVals.length; i++) {
                if (sngVals[i].parentNode === parm) {
                    parmSngVal = sngVals[i];
                    break;
                }
            }
        }

        // ✅ Fix around line 210 in the main loop
        for (let e = 0; e < elems.length; e++) {
            const elem = elems[e] as XMLElement;
            const elemName = `${kwd}_ELEM${e}`;

            let elemVals = extractAllowedValues(elem);

            // ✅ For FIRST ELEM only - add parameter-level SngVal values
            if (e === 0 && parmSngVal) {
                // OLD: const parmSngValues = (parmSngVal as any).querySelectorAll("Value");
                // NEW: Use getElementsByTagName
                const parmSngValues = (parmSngVal as any).getElementsByTagName("Value");
                for (let i = 0; i < parmSngValues.length; i++) {
                    const val = parmSngValues[i];
                    const valText = (val as any).getAttribute("Val");
                    if (valText && !elemVals.includes(valText)) {
                        elemVals.push(valText);
                    }
                }
                console.log(`[clPrompter] Added parameter SngVal to first ELEM ${elemName}:`, elemVals);
            }

            if (elemVals.length > 0) {
                allowedValsMap[elemName] = elemVals as any;

                if (isRestricted(elem)) {
                    (allowedValsMap[elemName] as any)._noCustomInput = true;
                }
            }

            // ✅ Process nested sub-elements (ELEM within ELEM)
            processNestedElements(elem, elemName, allowedValsMap);
        }

        // --- Process QUAL elements ---
        const quals = Array.from(parm.getElementsByTagName("Qual")) as XMLElement[];
        for (let q = 0; q < quals.length; q++) {
            const qual = quals[q];
            const qualName = `${kwd}_QUAL${q}`;
            const qualVals = extractAllowedValues(qual);

            if (qualVals.length > 0) {
                allowedValsMap[qualName] = qualVals as any;

                if (isRestricted(qual)) {
                    (allowedValsMap[qualName] as any)._noCustomInput = true;
                }
            }
        }
    });

    console.log("[clPrompter] allowedValsMap built successfully:", allowedValsMap);
    return allowedValsMap;
}

/**
 * Extract just the range information from allowed values
 */
export function extractRangeInfo(allowedVals: string[]): RangeInfo | undefined {
    const rangeMetadata = allowedVals.find(v => v.startsWith('_RANGE_'));
    if (!rangeMetadata) return undefined;

    const parts = rangeMetadata.split('_');
    if (parts.length >= 4) {
        return {
            from: parts[2],
            to: parts[3],
            source: rangeMetadata.includes('from attributes') ? 'attributes' : 'child-elements'
        };
    }
    return undefined;
}

/**
 * Check if parameter has special values (non-range values)
 */
export function hasSpecialValues(allowedVals: string[]): boolean {
    return allowedVals.some(v => v && v !== '_noCustomInput' && !v.startsWith('_RANGE_'));
}

/**
 * Get just the special values (filtering out range metadata)
 */
export function getSpecialValues(allowedVals: string[]): string[] {
    return allowedVals.filter(v => v && v !== '_noCustomInput' && !v.startsWith('_RANGE_'));
}