// VS Code config import
import * as vscode from 'vscode';

import { DOMParser } from '@xmldom/xmldom';
import { ParmMeta } from './types';
import { tokenizeCL, formatCL_SEU, parseCL } from './tokenizeCL'; // ← add parseCL
import { collectCLCmdFromLine } from './extractor'; // ← add this import

// Type aliases must be declared before use
type AllowedValsMap = Record<string, string[]>; // e.g. { OBJTYPE: ["*ALL", "*FILE", ...], ... }
type ParmTypeMap = Record<string, string>;      // e.g. { OBJTYPE: "NAME", ... }

export type CaseOption = '*UPPER' | '*LOWER' | '*NONE';
export type IndentRemarks = '*NO' | '*YES';

export interface FormatOptions {
  cvtcase: CaseOption;
  indrmks: IndentRemarks;
  labelpos: number;
  bgncol: number;
  indcol: number;
  indcont: number;
}

// ✅ Update groupNestedElems to handle numeric pattern
// ✅ Fix groupNestedElems to preserve ALL non-ELEM parameters
function groupNestedElems(values: Record<string, any>, parmTypeMap: ParmTypeMap): { grouped: Record<string, any>, updatedTypeMap: ParmTypeMap } {
  const grouped: Record<string, any> = {};
  const updatedTypeMap: ParmTypeMap = { ...parmTypeMap };
  const processed = new Set<string>();

  // Copy all regular parameters
  for (const [key, value] of Object.entries(values)) {
    const isSimpleElem = key.match(/^(.+)_ELEM\d+$/);
    const isNestedElem = key.match(/^(.+)_ELEM(\d+)_(QUAL|SUB)(\d+)$/);
    if (!isSimpleElem && !isNestedElem) {
      grouped[key] = value;
      console.log(`[groupNestedElems] Preserved regular parameter: ${key}`, value);
    }
  }

  // Find all ELEM parameters
  const elemParams = new Set<string>();
  for (const key of Object.keys(values)) {
    const simpleElemMatch = key.match(/^(.+)_ELEM\d+$/);
    const nestedElemMatch = key.match(/^(.+)_ELEM(\d+)_(QUAL|SUB)(\d+)$/);
    if (simpleElemMatch) {
      elemParams.add(simpleElemMatch[1]);
    } else if (nestedElemMatch) {
      elemParams.add(nestedElemMatch[1]);
    }
  }

  // Process ELEM parameters
  for (const baseParam of elemParams) {
    const elemValues: (string | string[])[] = [];
    let elemIndex = 0;

    while (true) {
      const simpleElemKey = `${baseParam}_ELEM${elemIndex}`;
      const qualKey0 = `${baseParam}_ELEM${elemIndex}_QUAL0`;
      const subKey0 = `${baseParam}_ELEM${elemIndex}_SUB0`;

      if (values[simpleElemKey] !== undefined) {
        elemValues.push(values[simpleElemKey]);
        processed.add(simpleElemKey);
      } else if (values[qualKey0] !== undefined) {
        // Collect QUAL parts
        const qualParts: string[] = [];
        let qualIndex = 0;
        while (true) {
          const qualKey = `${baseParam}_ELEM${elemIndex}_QUAL${qualIndex}`;
          if (values[qualKey] !== undefined) {
            qualParts.push(values[qualKey]);
            processed.add(qualKey);
            qualIndex++;
          } else {
            break;
          }
        }
        if (qualParts.length > 0) {
          elemValues.push(qualParts);
        }
      } else if (values[subKey0] !== undefined) {
        // Collect SUB parts
        const subParts: string[] = [];
        let subIndex = 0;
        while (true) {
          const subKey = `${baseParam}_ELEM${elemIndex}_SUB${subIndex}`;
          if (values[subKey] !== undefined) {
            subParts.push(values[subKey]);
            processed.add(subKey);
            subIndex++;
          } else {
            break;
          }
        }
        if (subParts.length > 0) {
          elemValues.push(subParts);
        }
      } else {
        break;
      }
      elemIndex++;
    }

    if (elemValues.length > 0) {
      grouped[baseParam] = elemValues;
      updatedTypeMap[baseParam] = 'ELEM';
      console.log(`[groupNestedElems] Grouped ELEM ${baseParam}:`, elemValues);
    }
  }

  console.log('[groupNestedElems] Original values:', Object.keys(values));
  console.log('[groupNestedElems] Final grouped values:', Object.keys(grouped));

  return { grouped, updatedTypeMap };
}

// ✅ Function build command string after prompter.
export function buildCLCommand(
  cmdName: string,
  values: Record<string, any>,
  defaults: Record<string, any>,
  allowedValsMap: AllowedValsMap,
  parmTypeMap: ParmTypeMap,
  parmMetas: ParmMeta[],
  presentParms?: Set<string>,
  qualGroupsMap?: Record<string, string[][]>
): string {
  // If a label is present in values, prepend it to the command string
  let cmd = '';
  if (values && typeof values === 'object') {
    // Look for a label property (case-insensitive, e.g. 'LABEL', 'Lbl', etc.)
    const labelKey = Object.keys(values).find(k => k.toLowerCase() === 'label');
    if (labelKey !== undefined) {
      const labelVal = values[labelKey];
      if (typeof labelVal === 'string' && labelVal.trim() !== '') {
        // Always prepend label (with colon) if present and non-empty
        cmd = labelVal.trim().toUpperCase() + ': ';
      }
    }
  }
  cmd += cmdName;

  // Remove *LIBL/ from the command name if present
  const LIBL = '*LIBL/';
  if (cmd.toUpperCase().startsWith(LIBL)) {
    cmd = cmd.substring(LIBL.length);
  }

  // ✅ Check if this command actually has ELEM pattern keys
  // ✅ Support both simple and nested ELEM patterns
      // Replace current hasElemPatterns with:
    const hasElemPatterns = Object.keys(values).some(key =>
      /^.+_ELEM\d+$/.test(key) ||                 // simple
      /^.+_ELEM\d+_(QUAL|SUB)\d+$/.test(key)      // nested QUAL/SUB
    );


  // ✅ Only process ELEM grouping if there are ELEM patterns
  let groupedValues: Record<string, any>;
  let updatedTypeMap: ParmTypeMap;

  if (hasElemPatterns) {
    console.log('[buildCLCommand] ELEM patterns detected, calling groupNestedElems...');
    const result = groupNestedElems(values, parmTypeMap);
    groupedValues = result.grouped;
    updatedTypeMap = result.updatedTypeMap;
  } else {
    console.log('[buildCLCommand] No ELEM patterns, using values directly');
    groupedValues = values; // ✅ Use original values directly
    updatedTypeMap = parmTypeMap;
  }

  // Track which parameters have already been handled
  const handledParms = new Set<string>();

  // Handle QUAL/ELEM grouping if qualGroupsMap is provided
  if (qualGroupsMap) {
    for (const [kwd, qualInstances] of Object.entries(qualGroupsMap)) {
      if (!qualInstances.length) continue;

      const metaForKwd = parmMetas.find(m => m.Kwd === kwd);
      if (metaForKwd?.Elems && metaForKwd.Elems.length > 0) {
        console.log(`[buildCLCommand] Skipping qualGroupsMap for ${kwd} because it has ELEM children.`);
        continue;
      }
      // Only include if user changed or value differs from default
      const defaultVal = defaults && defaults[kwd];
      const userChanged = presentParms?.has(kwd);

      // Check if all instances are empty or default
      const allEmptyOrDefault = qualInstances.every(instanceArr =>
        instanceArr.every((v, idx) =>
        (v === undefined || v === null || v === '' ||
          (!userChanged &&
            defaultVal &&
            (
              Array.isArray(defaultVal)
                ? v.toString().trim().toUpperCase() === (defaultVal[idx] || '').toString().trim().toUpperCase()
                : v.toString().trim().toUpperCase() === defaultVal.toString().trim().toUpperCase()
            )
          )
        )
        )
      );
      if (allEmptyOrDefault) continue;

      const allowedVals = allowedValsMap[kwd] || [];
      const parmType = updatedTypeMap[kwd] || "";
      const qualStrings = qualInstances.map(instanceArr =>
        instanceArr
          .map((v, idx) => quoteIfNeeded(v, allowedVals, parmType))
          .join('/')
      );
      cmd += ` ${kwd}(${qualStrings.join(' ')})`;
      handledParms.add(kwd);
    }
  }

  // Output parameters in the order defined by parmMetas
  for (const meta of parmMetas) {
    const key = meta.Kwd;
    if (handledParms.has(key)) continue;

    // ✅ Use grouped values instead of raw values
    let value = groupedValues[key];

    const hasElemChildren = meta.Elems && meta.Elems.length > 0;
    const hasQualChildren = meta.Quals && meta.Quals.length > 0;
    const isMultiInstance = meta.Max ? (+meta.Max > 1) : false;

    // --- ELEM/QUAL/SIMPLE parameter skip logic ---
    // For ELEM parameters: include if value exists (webview already filtered based on touch/original)
    if (hasElemChildren) {
      // If value is undefined/null/empty, skip
      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.every(v => v === undefined || v === null || v === ''))
      ) {
        continue;
      }
      // Otherwise include it - webview already determined it should be returned
    } else if (hasQualChildren) {
      // For QUAL parameters: skip if not touched and matches default
      const defaultVal = defaults && defaults[key];
      const userChanged = presentParms?.has(key);
      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (!userChanged && defaultVal && deepEqual(normalizeValue(value), normalizeValue(defaultVal)))
      ) {
        continue;
      }
    } else if (isMultiInstance) {
      // Multi-instance, non-ELEM/QUAL parameter (e.g. PRINT, FMTOPT, SRCOPT)
      const defaultVal = defaults && defaults[key];
      if (
        value === undefined ||
        value === null ||
        (Array.isArray(value) && value.length === 0)
      ) {
        continue;
      }
      if (
        Array.isArray(value) &&
        value.length === 1 &&
        defaultVal !== undefined &&
        !presentParms?.has(key) &&
        value[0].toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? defaultVal[0] : defaultVal || '').toString().trim().toUpperCase()
      ) {
        continue;
      }
    } else {
      // Simple, single-instance parameter
      const defaultVal = defaults && defaults[key];
      const valNorm = (Array.isArray(value) ? value[0] : value) || '';
      const defNorm = (Array.isArray(defaultVal) ? defaultVal[0] : defaultVal) || '';
      if (
        valNorm === undefined ||
        valNorm === null ||
        valNorm === '' ||
        (!presentParms?.has(key) &&
          defNorm !== undefined &&
          valNorm.toString().trim().toUpperCase() === defNorm.toString().trim().toUpperCase())
      ) {
        continue;
      }
    }

    const allowedVals = allowedValsMap[key] || [];
    const parmType = updatedTypeMap[key] || "";

    // --- BEGIN ELEM-EMIT ---
    if (hasElemChildren && Array.isArray(value)) {
      if (parmType === 'ELEM') {
        const elemParts: string[] = [];
        for (const [i, elemValue] of value.entries()) {
          if (Array.isArray(elemValue)) {
            // Only use slash notation for first ELEM in single-instance parameters
            if (i === 0 && elemValue.length === 2 && !isMultiInstance) {
              const quoted = elemValue.map(v => quoteIfNeeded(v, allowedVals, parmType)).reverse();
              elemParts.push(`${quoted[0]}/${quoted[1]}`);
            } else {
              const quoted = elemValue.map(v => quoteIfNeeded(v, allowedVals, parmType));
              elemParts.push(`(${quoted.join(' ')})`);
            }
          } else {
            elemParts.push(quoteIfNeeded(elemValue, allowedVals, parmType));
          }
        }
        if (isMultiInstance && elemParts.length > 0) {
          const wrappedParts = elemParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
        } else {
          cmd += ` ${key}(${elemParts.join(' ')})`;
        }
      } else {
        const elemParts = value.map((vArr: any) =>
          Array.isArray(vArr)
            ? vArr.map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join(' ')
            : quoteIfNeeded(vArr, allowedVals, parmType)
        );
        if (isMultiInstance) {
          const wrappedParts = elemParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
        } else {
          cmd += ` ${key}(${elemParts.join(' ')})`;
        }
      }
    } else if (hasQualChildren && Array.isArray(value)) {
      const defaultVal = defaults && defaults[key];
      const userChanged = presentParms?.has(key);
      const allEmptyOrDefault = Array.isArray(value[0])
        ? value.every((vArr: any, idx: number) =>
          Array.isArray(vArr)
            ? vArr.every((v: any, j: number) =>
            (v === undefined || v === null || v === '' ||
              (!userChanged &&
                defaultVal &&
                Array.isArray(defaultVal[idx])
                ? v.toString().trim().toUpperCase() === (defaultVal[idx][j] || '').toString().trim().toUpperCase()
                : v.toString().trim().toUpperCase() === (defaultVal[j] || '').toString().trim().toUpperCase()
              )
            )
            )
            : (vArr === undefined || vArr === null || vArr === '' ||
              (!userChanged &&
                defaultVal &&
                vArr.toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? (defaultVal[idx] || '') : defaultVal).toString().trim().toUpperCase()
              )
            )
        )
        : value.every((v: any, idx: number) =>
        (v === undefined || v === null || v === '' ||
          (!userChanged &&
            defaultVal &&
            v.toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? (defaultVal[idx] || '') : defaultVal).toString().trim().toUpperCase()
          )
        )
        );

      if (allEmptyOrDefault) {
        continue;
      }

      if (Array.isArray(value[0])) {
        const qualParts = value.map((vArr: any) =>
          Array.isArray(vArr)
            ? vArr.slice().filter((x: any) => x !== undefined && x !== null && x !== '').map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join('/')
            : quoteIfNeeded(vArr, allowedVals, parmType)
        );
        if (isMultiInstance) {
          const wrappedParts = qualParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
        } else {
          cmd += ` ${key}(${qualParts.join(' ')})`;
        }
      } else {
        const qualPart = value.slice().filter((x: any) => x !== undefined && x !== null && x !== '').map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join('/');
        cmd += ` ${key}(${qualPart})`;
      }
    } else if (Array.isArray(value)) {
      if (isMultiInstance) {
        if (hasElemChildren || hasQualChildren) {
          const wrappedValues = value.map(v => `(${quoteIfNeeded(v, allowedVals, parmType)})`);
          cmd += ` ${key}(${wrappedValues.join(' ')})`;
        } else {
          const quotedParts = value.filter(v => v !== undefined && v !== null && v !== '').map(v => quoteIfNeeded(v, allowedVals, parmType));
          cmd += ` ${key}(${quotedParts.join(' ')})`;
        }
      } else {
        const quotedParts = value.filter(v => v !== undefined && v !== null && v !== '').map(v => quoteIfNeeded(v, allowedVals, parmType));
        cmd += ` ${key}(${quotedParts.join(' ')})`;
      }
    } else {
      let q = quoteIfNeeded(String(value).trim(), allowedVals, parmType);
      cmd += ` ${key}(${q})`;
    }
  }
  return cmd;
}


function normalizeValue(val: any): any {
  // Handle string values
  if (typeof val === 'string') {
    let trimmed = val.trim();

    // Remove outer parentheses if present
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      trimmed = trimmed.slice(1, -1).trim();
    }

    // Handle qualified values (LIB/OBJ)
    if (trimmed.includes('/')) {
      return trimmed.split('/').map(s => s.trim().toUpperCase());
    }

    // Handle space-separated values (ELEM parts)
    if (trimmed.includes(' ')) {
      return trimmed.split(/\s+/).map(s => s.trim().toUpperCase());
    }

    // Single value
    return trimmed.toUpperCase();
  }

  // Handle array values - normalize each element
  if (Array.isArray(val)) {
    return val.map(v => normalizeValue(v));
  }

  return val;
}

function deepEqual(a: any, b: any): boolean {
  // Handle null/undefined
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  // If both are arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // If both are strings (or can be converted to strings)
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
  }

  // Direct comparison for other types
  return a === b;
}

function isCLExpression(val: string): boolean {
  // Detect common CL operators
  const ops = ['*CAT', '*TCAT', '*BCAT', '*EQ', '*NE', '*LT', '*LE', '*GT', '*GE'];
  const trimmed = val.trim().toUpperCase();

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true;
  if (ops.some(op => trimmed.includes(op))) return true;
  // Detect any %functionName( pattern (future-proof for new CL built-ins)
  if (/%[A-Z][A-Z0-9]*\s*\(/i.test(trimmed)) return true;
  // Also treat any value with an ampersand variable and operator as an expression
  if (/&[A-Z][A-Z0-9]*\s*[*%]/i.test(trimmed)) return true;
  return false;
}

export function quoteIfNeeded(val: string, allowedVals: string[] = [], parmType: string = ""): string {
  const trimmed = val.trim();
  const type = parmType.toUpperCase().replace(/^[*]/, "");

  // TYPE(*CMD || *CMDSTR) are never quote processed.
  if (type.startsWith('CMD')) {
    return trimmed;
  }

  function isCLQuotedString(s: string): boolean {
    if (s.length < 2 || !s.startsWith("'") || !s.endsWith("'")) return false;
    const inner = s.slice(1, -1);
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === "'") {
        if (inner[i + 1] === "'") {
          i += 2; // Escaped ''
        } else {
          return false; // Unescaped single quote
        }
      } else {
        i++;
      }
    }
    return true;
  }

  // 1. Do not quote CL variable names, such as: &COUNT
  if (/^&[A-Z][A-Z0-9]{0,9}$/i.test(trimmed)) {
    return trimmed;
  }

  // 2. Do not quote hexadecimal notation: X'...' (case-insensitive)
  if (/^[xX]'[0-9A-Fa-f]*'$/.test(trimmed)) {
    return trimmed;
  }

  // 3. Do not quote allowed keywords or values (e.g. *YES, *FILE)
  if (allowedVals.some(v => v.toUpperCase() === trimmed.toUpperCase()) || trimmed.startsWith("*")) {
    return trimmed;
  }

  // 4. Already a properly quoted CL string
  if (isCLQuotedString(trimmed)) {
    return trimmed;
  }

  // 5. Double-quoted string from user input
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }

  // 6. Library-qualified name like QGPL/CUST
  if (/^[A-Z0-9$#@_]+\/[A-Z0-9$#@_]+$/i.test(trimmed)) {
    return trimmed;
  }

  // 7. Unqualified valid CL name
  if (/^[A-Z$#@][A-Z0-9$#@_]{0,10}$/i.test(trimmed)) {
    return trimmed;
  }

  // 8. If type hints at NAME-like field and it's valid
  if (["NAME", "PNAME", "CNAME"].includes(type) && isValidName(trimmed)) {
    return trimmed;
  }

  // 9. CL expression (e.g., *IF &X = &Y)
  if (isCLExpression(trimmed)) {
    return val;
  }

  // 10. Special case: empty quoted or blank
  if (trimmed === "''" || trimmed === "") {
    return "";
  }

  // 11. Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // 12. Recover unescaped single-quoted string
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const inner = trimmed.slice(1, -1).replace(/'/g, "''");
    return `'${inner}'`;
  }

  // 13. Default: Quote and escape embedded single quotes
  return `'${trimmed.replace(/'/g, "''")}'`;
}


export function isValidName(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed.startsWith("&")) {
    return /^[&][A-Z$#@][A-Z0-9$#@_.]{0,10}$/i.test(trimmed);
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return true;
  }
  return /^[A-Z$#@][A-Z0-9$#@_.]{0,10}$/i.test(trimmed);
}


export function extractAllowedValsAndTypes(xml: string): { allowedValsMap: AllowedValsMap, parmTypeMap: ParmTypeMap } {
  const allowedValsMap: AllowedValsMap = {};
  const parmTypeMap: ParmTypeMap = {};
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parms = doc.getElementsByTagName("Parm");
  for (let i = 0; i < parms.length; i++) {
    const parm = parms[i];
    const kwd = parm.getAttribute("Kwd");
    if (!kwd) continue;
    parmTypeMap[kwd] = parm.getAttribute("Type") || "";
    const vals: string[] = [];
    // SpcVal
    const spcVals = parm.getElementsByTagName("SpcVal");
    for (let s = 0; s < spcVals.length; s++) {
      const values = spcVals[s].getElementsByTagName("Value");
      for (let v = 0; v < values.length; v++) {
        vals.push(values[v].getAttribute("Val") || "");
      }
    }
    // SngVal
    const sngVals = parm.getElementsByTagName("SngVal");
    for (let s = 0; s < sngVals.length; s++) {
      const values = sngVals[s].getElementsByTagName("Value");
      for (let v = 0; v < values.length; v++) {
        vals.push(values[v].getAttribute("Val") || "");
      }
    }
    // Value
    const values = parm.getElementsByTagName("Value");
    for (let v = 0; v < values.length; v++) {
      vals.push(values[v].getAttribute("Val") || "");
    }
    allowedValsMap[kwd] = vals.map(v => v.toUpperCase());
  }
  return { allowedValsMap, parmTypeMap };
}

// Helper function to wrap comment content across continuation lines with + symbols
function wrapCommentOnContinuationLines(
  formattedLines: string[],
  commentContent: string,
  commentIndent: string,
  rightMargin: number
): void {
  const words = commentContent.split(/\s+/);
  let currentContent = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testContent = currentContent ? currentContent + ' ' + word : word;
    const isFirstWord = i === 0;
    const isLastWord = i === words.length - 1;

    // For first line, use "/* " prefix, for others no prefix
    const prefix = isFirstWord ? '/* ' : '';
    const suffix = isLastWord ? ' */' : ' +';

    const testLine = commentIndent + prefix + testContent + suffix;

    if (testLine.length <= rightMargin || !currentContent) {
      currentContent = testContent;
    } else {
      // Current line is full, push it and start new line
      const linePrefix = currentContent === testContent ? '/* ' : '';
      formattedLines.push(commentIndent + linePrefix + currentContent + ' +');
      currentContent = word;
    }
  }

  // Push final line with closing */
  if (currentContent) {
    const hasOpening = currentContent === words.join(' '); // All words fit on one line
    const prefix = hasOpening ? '/* ' : '';
    formattedLines.push(commentIndent + prefix + currentContent + ' */');
  }
}

export function formatCLSource(
  allLines: string[],
  options: FormatOptions,
  startIndex = 0
): string[] {
  let level = 1;
  let fromCase = '';
  let toCase = '';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = lowercase.toUpperCase();

  // Set up case conversion
  switch (options.cvtcase) {
    case '*UPPER':
      fromCase = lowercase;
      toCase = uppercase;
      break;
    case '*LOWER':
      fromCase = uppercase;
      toCase = lowercase;
      break;
    default:
      break;
  }

  const outputLines: string[] = [];
  let idx = startIndex;

  // Create a simple document-like object for collectCLCmdFromLine
  const mockDoc = {
    lineCount: allLines.length,
    lineAt: (index: number) => ({
      text: allLines[index] || ''
    })
  } as vscode.TextDocument;

  while (idx < allLines.length) {
    const currentLine = allLines[idx];
    if (!currentLine) {
      idx++;
      continue;
    }

    const trimmedLine = currentLine.trim();

    // Handle empty lines
    if (trimmedLine.length === 0) {
      outputLines.push('');
      idx++;
      continue;
    }

    // Handle comment lines
    if (trimmedLine.startsWith('/*')) {
      if (options.indrmks === '*NO') {
        // Keep comment at original position
        outputLines.push(currentLine);
      } else {
        // Indent comment to current level
        const commentIndent = level > 1 ? ' '.repeat(options.indcol * (level - 1)) : '';
        outputLines.push(commentIndent + trimmedLine);
      }
      idx++;
      continue;
    }

    // First, peek ahead to find the end of this command and extract any trailing comment
    let trailingComment: string | undefined;
    let peekIdx = idx;

    // Find the last line of this command by checking for continuation characters
    while (peekIdx < allLines.length) {
      const peekLine = allLines[peekIdx];
      if (!peekLine) break;

      const codePart = peekLine.replace(/\/\*.*\*\//g, '').trimEnd();
      const hasContinuation = codePart.endsWith('+') || codePart.endsWith('-');

      // Check for trailing comment on this line
      const commentMatch = peekLine.match(/\/\*.*?\*\/\s*$/);
      if (commentMatch && !hasContinuation) {
        // This is the last line and it has a trailing comment
        trailingComment = commentMatch[0].trim();
        break;
      }

      if (!hasContinuation) {
        break;
      }
      peekIdx++;
    }

    // Use collectCLCmdFromLine to get the complete command (comments already stripped)
    const cmdResult = collectCLCmdFromLine(mockDoc, idx);
    let command = cmdResult.command;
    idx = cmdResult.endLine + 1; // Move past the command

    // Handle CL tags (labels ending with :)
    let label: string | undefined;
    if (command.includes(':')) {
      const colonIdx = command.indexOf(':');
      const possibleTag = command.substring(0, colonIdx + 1).trim();
      if (/^[A-Z_][A-Z0-9_]*:$/.test(possibleTag)) {
        // Extract label
        label = possibleTag.slice(0, -1); // Remove the colon
        if (options.cvtcase !== '*NONE') {
          label = translateCase(label, fromCase, toCase);
        }

        // Get the rest after the tag
        command = command.substring(colonIdx + 1).trim();
        if (!command) {
          // Just a label line
          outputLines.push(label + ':');
          continue;
        }
      }
    }

    // Tokenize and format the command using formatCL_SEU
    try {
      const tokens = tokenizeCL(command);
      const node = parseCL(tokens);

      // Apply case conversion to the command name if needed
      if (options.cvtcase !== '*NONE' && node.name) {
        node.name = translateCase(node.name, fromCase, toCase);
      }

      // Format using the proper CL formatter
      const formatted = formatCL_SEU(node, label);

      // Split into lines
      const formattedLines = formatted.split('\n');

      // If there's a trailing comment, handle it with word wrapping and continuation characters
      if (trailingComment) {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const rightMargin = config.get<number>('formatRightMargin', 72);
        const contCol = config.get<number>('formatContinuePosition', 27);

        const lastLineIdx = formattedLines.length - 1;
        let lastLine = formattedLines[lastLineIdx];
        const lastLineEndsWithCont = lastLine.trimEnd().endsWith('+') || lastLine.trimEnd().endsWith('-');

        // Extract comment content between /* and */
        const commentMatch = trailingComment.match(/^\/\*\s*(.*?)\s*\*\/$/);
        if (!commentMatch) {
          // Malformed comment, just append as-is
          if (!lastLineEndsWithCont) {
            formattedLines[lastLineIdx] = lastLine + ' ' + trailingComment;
          } else {
            formattedLines.push(' '.repeat(contCol) + trailingComment);
          }
        } else {
          const commentContent = commentMatch[1];
          const commentIndent = ' '.repeat(contCol);

          if (!lastLineEndsWithCont) {
            // Try to fit comment on the last line
            const testLine = lastLine + ' /* ' + commentContent + ' */';

            if (testLine.length <= rightMargin) {
              // Fits on same line
              formattedLines[lastLineIdx] = testLine;
            } else {
              // Need to wrap - start comment on same line if there's room
              const availableOnLastLine = rightMargin - lastLine.length - 4; // -4 for ' /* '

              if (availableOnLastLine > 10) { // At least some room for content
                // Start comment on this line
                const words = commentContent.split(/\s+/);
                let firstLineContent = '';
                let remainingWords: string[] = [];

                // Fill first line
                for (let i = 0; i < words.length; i++) {
                  const word = words[i];
                  const testContent = firstLineContent ? firstLineContent + ' ' + word : word;

                  if ((' /* ' + testContent + ' +').length <= rightMargin - lastLine.length) {
                    firstLineContent = testContent;
                  } else {
                    remainingWords = words.slice(i);
                    break;
                  }
                }

                if (firstLineContent) {
                  formattedLines[lastLineIdx] = lastLine + ' /* ' + firstLineContent + ' +';

                  // Continue on next line(s)
                  let currentContent = '';
                  for (const word of remainingWords) {
                    const testContent = currentContent ? currentContent + ' ' + word : word;
                    const isLastWord = word === remainingWords[remainingWords.length - 1];
                    const suffix = isLastWord ? ' */' : ' +';

                    if ((commentIndent + testContent + suffix).length <= rightMargin || !currentContent) {
                      currentContent = testContent;
                    } else {
                      // Current line is full
                      formattedLines.push(commentIndent + currentContent + ' +');
                      currentContent = word;
                    }
                  }

                  if (currentContent) {
                    formattedLines.push(commentIndent + currentContent + ' */');
                  }
                } else {
                  // Can't fit anything on first line, put entire comment on continuation lines
                  wrapCommentOnContinuationLines(formattedLines, commentContent, commentIndent, rightMargin);
                }
              } else {
                // Not enough room on last line, put entire comment on continuation lines
                wrapCommentOnContinuationLines(formattedLines, commentContent, commentIndent, rightMargin);
              }
            }
          } else {
            // Last line ends with continuation - put comment on next line(s)
            wrapCommentOnContinuationLines(formattedLines, commentContent, commentIndent, rightMargin);
          }
        }
      }

      outputLines.push(...formattedLines);

      // Update nesting level based on command
      const upperCmd = command.toUpperCase();
      if (upperCmd.includes(' DO ') || upperCmd.startsWith('DO ') || upperCmd.endsWith(' DO')) {
        level++;
      }
      if (upperCmd.includes('ENDDO')) {
        level = Math.max(1, level - 1);
      }
    } catch (error) {
      // If tokenization fails, fall back to simple formatting
      console.error('[formatCLSource] Tokenization failed:', error);
      if (label) {
        outputLines.push(label + ':');
      }
      outputLines.push(...writeFormatted(command, level, options));
    }
  }

  return outputLines;
}

// --- Helper Functions ---

function translateCase(str: string, fromCase: string, toCase: string): string {
  let result = '';
  for (const ch of str) {
    const idx = fromCase.indexOf(ch);
    result += idx >= 0 ? toCase[idx] : ch;
  }
  return result;
}

function convertCaseWithQuotes(input: string, fromCase: string, toCase: string): string {
  let result = '';
  let inQuote = false;
  for (const ch of input) {
    if (ch === "'") {
      inQuote = !inQuote;
      result += ch;
    } else if (!inQuote) {
      const idx = fromCase.indexOf(ch);
      result += idx >= 0 ? toCase[idx] : ch;
    } else {
      result += ch;
    }
  }
  return result;
}

function formatDCL(input: string): string {
  // Align DCL parameters (simple version)
  const parts = input.trim().split(/\s+/);
  const dcl = parts[0];
  const variable = (parts[1] || '').padEnd(17, ' ');
  const type = (parts[2] || '').padEnd(12, ' ');
  let varlen = '';
  let other = '';
  if (parts[3] && parts[3].toUpperCase().startsWith('LEN(')) {
    varlen = parts[3].padEnd(11, ' ');
    other = parts.slice(4).join(' ');
  } else {
    other = parts.slice(3).join(' ');
  }
  return `${dcl} ${variable}${type}${varlen}${other}`;
}

function writeFormatted(
  input: string,
  level: number,
  options: FormatOptions
): string[] {
  // Indent based on nesting level
  let indent = '';
  if (level <= 10) {
    indent = ' '.repeat(options.indcol * (level - 1) + options.bgncol);
  } else {
    indent = ' '.repeat(options.indcol * 9 + options.bgncol);
  }
  const maxlength = 70 - indent.length;
  const lines: string[] = [];

  const lastNonSpaceChar = (s: string): string => {
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (ch !== ' ' && ch !== '\t') return ch;
    }
    return '';
  };
  const needsLeadingSpace = (prevTail: string, nextHead: string): boolean => {
    if (!prevTail || !nextHead) return false;
    // Treat '/', '&', quotes, parens, operators as tokens
    const prevToken = /[A-Za-z0-9_*')&/]/.test(prevTail);
    const nextToken = /['"(A-Za-z0-9_*&/]/.test(nextHead);
    return prevToken && nextToken;
  };

  let inputLeft = input;
  let continued = false;
  let prevTail = '';

  while (inputLeft.length > 0) {
    let chunk = '';
    const limit = (!continued ? maxlength : (maxlength - options.indcont));

    if (inputLeft.length <= limit) {
      chunk = inputLeft;
      inputLeft = '';
      // Ensure leading space on continued lines if we split between tokens previously
      if (continued && chunk.length > 0 && chunk[0] !== ' ' && needsLeadingSpace(prevTail, chunk[0])) {
        chunk = ' ' + chunk;
      }
    } else {
      // Break at last space before limit
      let breakPos = inputLeft.lastIndexOf(' ', limit - 1);
      if (breakPos <= 0) { breakPos = limit - 1; }

      // Left piece FOR THIS LINE; drop trailing spaces
      const leftPiece = inputLeft.slice(0, breakPos).replace(/[ \t]+$/, '');
      chunk = leftPiece + ' +';

      // Remainder AFTER the split-space (skip it explicitly)
      const remainder = inputLeft.slice(breakPos + 1);
      inputLeft = remainder;

      // Record tail before we add " +"
      prevTail = lastNonSpaceChar(leftPiece);

      // Push this wrapped line now
      if (continued) {
        lines.push(indent + ' '.repeat(options.indcont) + chunk);
      } else {
        lines.push(indent + chunk);
      }
      continued = true;

      // Before next iteration, if remainder starts with a token and prevTail is a token,
      // insert a leading space to preserve separation
      if (inputLeft.length > 0 && inputLeft[0] !== ' ' && needsLeadingSpace(prevTail, inputLeft[0])) {
        inputLeft = ' ' + inputLeft;
      }

      continue;
    }

    // Push the final/non-wrapped chunk
    if (continued) {
      lines.push(indent + ' '.repeat(options.indcont) + chunk);
    } else {
      lines.push(indent + chunk);
    }
  }
  return lines;
}

export function safeExtractKwdArg(cmd: string, kwd: string): string | null {
  const s = String(cmd ?? '');
  const kwdU = kwd.toUpperCase();
  let inStr = false, quote: "'"|'"'|'' = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === quote) {
        if (quote === "'" && s[i+1] === "'") { i++; continue; }
        inStr = false; quote = '';
      }
      continue;
    } else if (ch === "'" || ch === '"') { inStr = true; quote = ch as any; continue; }

    if (ch.toUpperCase() === kwdU[0]) {
      let k = 0;
      while (k < kwdU.length && s[i+k] && s[i+k].toUpperCase() === kwdU[k]) k++;
      if (k === kwdU.length) {
        let j = i + k;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
        if (s[j] === '(') {
          let depth = 1; inStr = false; quote = ''; let p = j + 1;
          while (p < s.length && depth > 0) {
            const c = s[p];
            if (inStr) {
              if (c === quote) {
                if (quote === "'" && s[p+1] === "'") { p += 2; continue; }
                inStr = false; quote = '';
              }
            } else {
              if (c === "'" || c === '"') { inStr = true; quote = c as any; }
              else if (c === '(') depth++;
              else if (c === ')') { depth--; if (depth === 0) return s.slice(j+1, p); }
            }
            p++;
          }
          return null;
        }
      }
    }
  }
  return null;
}



export function rewriteLeadingPositionalsByList(fullCmd: string, positionalKwds: string[], cmdMaxPos?: number): string {
  const tokens = tokenizeCL(fullCmd);
  if (!tokens.length || positionalKwds.length === 0) return fullCmd;
  const cmdIdx = tokens.findIndex(t => t.type === 'command');
  if (cmdIdx < 0) return fullCmd;

  const limit = Number.isFinite(cmdMaxPos as number) && (cmdMaxPos as number)! >= 0
    ? Math.min(positionalKwds.length, (cmdMaxPos as number))
    : positionalKwds.length;

  const kwdList = positionalKwds.slice(0, limit);
  const outVals = tokens.map(t => t.value);
  const isNamedAt = (idx: number) => tokens[idx]?.type === 'keyword' && tokens[idx + 1]?.type === 'paren_open';

  let i = cmdIdx + 1, posIdx = 0;
  while (i < tokens.length && posIdx < kwdList.length) {
    const t = tokens[i];
    if (t.type === 'space') { i++; continue; }
    if (isNamedAt(i)) break;

    if (t.type === 'paren_open') {
      let depth = 1, j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j].type === 'paren_open') depth++;
        else if (tokens[j].type === 'paren_close') depth--;
        j++;
      }
      const closeIdx = j - 1;
      if (closeIdx <= i) break;
      const inner = tokens.slice(i + 1, closeIdx).map(x => x.value).join('');
      const kwd = kwdList[posIdx++];
      outVals[i] = `${kwd}(${inner})`;
      for (let k = i + 1; k <= closeIdx; k++) outVals[k] = '';
      i = closeIdx + 1;
      continue;
    }

    const isBareKeyword = t.type === 'keyword' && tokens[i + 1]?.type !== 'paren_open';
    const isPositional = isBareKeyword || t.type === 'value' || t.type === 'string' || t.type === 'variable' || t.type === 'symbolic_value' || t.type === 'function';
    if (!isPositional) break;

    const kwd = kwdList[posIdx++];
    outVals[i] = `${kwd}(${t.value})`;
    i++;
  }

  return outVals.join('');
}

