
// VS Code config import
import * as vscode from 'vscode';

import { DOMParser } from '@xmldom/xmldom';
import { ParmMeta } from './types';
import { tokenizeCL } from './tokenizeCL'; // ← add this import

// Type aliases must be declared before use
type AllowedValsMap = Record<string, string[]>; // e.g. { OBJTYPE: ["*ALL", "*FILE", ...], ... }
type ParmTypeMap = Record<string, string>;      // e.g. { OBJTYPE: "NAME", ... }

type CaseOption = '*UPPER' | '*LOWER' | '*NONE';
type IndentRemarks = '*NO' | '*YES';

interface FormatOptions {
  cvtcase: CaseOption;
  indrmks: IndentRemarks;
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

    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.every(v => v === undefined || v === null || v === '')) ||
      (!presentParms?.has(key) && defaults && deepEqual(normalizeValue(value), normalizeValue(defaults[key])))
    ) {
      continue;
    }
    const hasElemChildren = meta.Elems && meta.Elems.length > 0;
    const hasQualChildren = meta.Quals && meta.Quals.length > 0;
    const isMultiInstance = meta.Max ? (+meta.Max > 1) : false;

    // Always flatten single-element arrays for simple, single-instance parameters
    if (!hasElemChildren && !hasQualChildren && !isMultiInstance && Array.isArray(value) && value.length === 1) {
      value = value[0];
    }

    // --- NEW: Skip logic for simple and multi-instance parameters ---
    if (!hasElemChildren && !hasQualChildren && isMultiInstance) {
      // Multi-instance, non-ELEM/QUAL parameter (e.g. PRINT, FMTOPT, SRCOPT)
      const defaultVal = defaults && defaults[key];
      // If value is undefined/null/empty array, skip
      if (
        value === undefined ||
        value === null ||
        (Array.isArray(value) && value.length === 0)
      ) {
        continue;
      }
      // If value is array of length 1, and that value matches the default, and not presentParms, skip
      if (
        Array.isArray(value) &&
        value.length === 1 &&
        defaultVal !== undefined &&
        !presentParms?.has(key) &&
        value[0].toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? defaultVal[0] : defaultVal || '').toString().trim().toUpperCase()
      ) {
        console.log(`[buildCLCommand] Skipping multi-instance parameter ${key} (single default: "${value[0]}")`);
        continue;
      }
    } else if (!hasElemChildren && !hasQualChildren && !isMultiInstance) {
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
        console.log(`[buildCLCommand] Skipping simple parameter ${key} (unchanged default: "${valNorm}")`);
        continue;
      }
    } else {
      // For non-simple parameters (ELEM/QUAL), use the old skip logic
      const defaultVal = defaults && defaults[key];
      const userChanged = presentParms?.has(key);

      console.log(`[buildCLCommand] Checking ${key}: hasElem=${hasElemChildren}, hasQual=${hasQualChildren}`);
      console.log(`[buildCLCommand]   value=${JSON.stringify(value)}`);
      console.log(`[buildCLCommand]   default=${JSON.stringify(defaultVal)}`);
      console.log(`[buildCLCommand]   userChanged=${userChanged}`);
      console.log(`[buildCLCommand]   normalized value=${JSON.stringify(normalizeValue(value))}`);
      console.log(`[buildCLCommand]   normalized default=${JSON.stringify(normalizeValue(defaultVal))}`);
      console.log(`[buildCLCommand]   deepEqual=${deepEqual(normalizeValue(value), normalizeValue(defaultVal))}`);

      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (!userChanged && defaultVal && deepEqual(normalizeValue(value), normalizeValue(defaultVal)))
      ) {
        console.log(`[buildCLCommand] Skipping ${key} (matches default or empty)`);
        continue;
      }
    }

    const allowedVals = allowedValsMap[key] || [];
    const parmType = updatedTypeMap[key] || "";

    console.log(`[buildCLCommand] Processing ${key}: value=${JSON.stringify(value)}, type=${parmType}`);

    // --- BEGIN ELEM-EMIT ---
    if (hasElemChildren && Array.isArray(value)) {
      // ✅ ELEM parameter with complex structure
      if (parmType === 'ELEM') {
        // Expect: [ ['LIB','OBJ'], ['1','64'] ] for DTAARA
        const elemParts: string[] = [];
        for (const [i, elemValue] of value.entries()) {
          if (Array.isArray(elemValue)) {
            if (i === 0 && elemValue.length === 2) {
              // First top-level Elem is QUAL → join as LIB/OBJ (reverse UI order)
              const quoted = elemValue.map(v => quoteIfNeeded(v, allowedVals, parmType)).reverse();
              elemParts.push(`${quoted[0]}/${quoted[1]}`);
            } else {
              // Other Elem groups → wrap in parentheses
              const quoted = elemValue.map(v => quoteIfNeeded(v, allowedVals, parmType));
              elemParts.push(`(${quoted.join(' ')})`);
            }
          } else {
            elemParts.push(quoteIfNeeded(elemValue, allowedVals, parmType));
          }
        }
        // Multi-instance ELEM: wrap each group in parens
        // Single-instance ELEM: wrap overall once
        if (isMultiInstance && elemParts.length > 0) {
          const wrappedParts = elemParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
        } else {
          cmd += ` ${key}(${elemParts.join(' ')})`;
        }
      } else {
        // ✅ Regular ELEM parameter (array of parts)
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
      // Skip if all parts are empty or default and not changed by user
      const defaultVal = defaults && defaults[key];
      const userChanged = presentParms?.has(key);

      // For multi-instance QUAL, value is array of arrays; for single, array of parts
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

      // ✅ QUAL parameter (array of parts)
      if (Array.isArray(value[0])) {
        // Each vArr is an array of QUAL parts (e.g., ['OBJ', 'LIB'])
        const qualParts = value.map((vArr: any) =>
          Array.isArray(vArr)
            ? vArr.slice().filter((x: any) => x !== undefined && x !== null && x !== '').map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join('/')
            : quoteIfNeeded(vArr, allowedVals, parmType) // treat as atomic string
        );

        // Always wrap each instance in parentheses for QUAL with Max > 1
        if (isMultiInstance) {
          const wrappedParts = qualParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
          console.log(`[buildCLCommand] Added QUAL (always parens per instance): ${key}(${wrappedParts.join(' ')})`);
        } else {
          cmd += ` ${key}(${qualParts.join(' ')})`;
        }
      } else {
        // Reverse QUAL parts for single instance as well
        const qualPart = value.slice().filter((x: any) => x !== undefined && x !== null && x !== '').map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join('/');
        cmd += ` ${key}(${qualPart})`;
      }
    } else if (Array.isArray(value)) {
      // ✅ Multi-instance parameter (Max > 1) - regardless of type
      if (isMultiInstance) {
        // Always wrap each value in parens if the parameter has ELEM or QUAL children
        if (hasElemChildren || hasQualChildren) {
          // For multi-instance ELEM/QUAL, wrap each part in parentheses
          const wrappedValues = value.map(v => `(${quoteIfNeeded(v, allowedVals, parmType)})`);
          cmd += ` ${key}(${wrappedValues.join(' ')})`;
          console.log(`[buildCLCommand] Added parameter (ELEM/QUAL, always parens per instance): ${key}(${wrappedValues.join(' ')})`);
        } else {
          // For regular multi-instance parameters, do NOT wrap each value in parens
          // Remove trailing blanks from each quoted string part to avoid extra blanks in continued quoted strings
          // For continued quoted strings, do not trim or alter the quoted parts; just join as-is
          const quotedParts = value.map(v => quoteIfNeeded(v, allowedVals, parmType));
          cmd += ` ${key}(${quotedParts.join(' ')})`;
          console.log(`[buildCLCommand] Added multi-instance parameter (simple type, no trim): ${key}(${quotedParts.join(' ')})`);
        }
      } else {
        // Single instance or single value - no extra parentheses needed
        const quotedParts = value.map(v => quoteIfNeeded(v, allowedVals, parmType));
        cmd += ` ${key}(${quotedParts.join(' ')})`;
      }
    } else {
      // ✅ Simple parameter
      let q = quoteIfNeeded(value, allowedVals, parmType);
      cmd += ` ${key}(${q})`;
    }
  }
  console.log('[clPrompter::buildCLCommand] cmd: ', cmd);
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

  // 2. Do not quote allowed keywords or values (e.g. *YES, *FILE)
  if (allowedVals.some(v => v.toUpperCase() === trimmed.toUpperCase()) || trimmed.startsWith("*")) {
    return trimmed;
  }

  // 3. Already a properly quoted CL string
  if (isCLQuotedString(trimmed)) {
    return trimmed;
  }

  // 4. Double-quoted string from user input
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }

  // 5. Library-qualified name like QGPL/CUST
  if (/^[A-Z0-9$#@_]+\/[A-Z0-9$#@_]+$/i.test(trimmed)) {
    return trimmed;
  }

  // 6. Unqualified valid CL name
  if (/^[A-Z$#@][A-Z0-9$#@_]{0,10}$/i.test(trimmed)) {
    return trimmed;
  }

  // 7. If type hints at NAME-like field and it's valid
  if (["NAME", "PNAME", "CNAME"].includes(type) && isValidName(trimmed)) {
    return trimmed;
  }

  // 8. CL expression (e.g., *IF &X = &Y)
  if (isCLExpression(trimmed)) {
    return val;
  }

  // 9. Special case: empty quoted or blank
  if (trimmed === "''" || trimmed === "") {
    return "";
  }

  // 10. Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // 11. Recover unescaped single-quoted string
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const inner = trimmed.slice(1, -1).replace(/'/g, "''");
    return `'${inner}'`;
  }

  // 12. Default: Quote and escape embedded single quotes
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

  while (idx < allLines.length) {
    const source_record = allLines[idx++];
    if (!source_record) { break; }

    const sequence = source_record.substring(0, 6);
    const date = source_record.substring(6, 12);
    let source_data = source_record.substring(12, 92);

    // Handle CL tags (ending with :)
    const [tag, ...rest] = source_data.trim().split(/\s+/);
    const statement = rest.join(' ');
    if (tag.endsWith(':')) {
      let tagOut = tag;
      if (options.cvtcase !== '*NONE') {
        tagOut = translateCase(tag, fromCase, toCase);
      }
      outputLines.push(sequence + date + tagOut + ' +');
      if (statement.startsWith('+')) {
        continue;
      }
      source_data = statement;
    }

    // Write comments as-is if indrmks = '*NO'
    if (source_data.trim().startsWith('/*') && options.indrmks === '*NO') {
      outputLines.push(sequence + date + source_data);
      continue;
    }

    // Build command string (handle continuations)
    const input = buildCommandString(source_data, allLines, idx);
    idx += input.linesConsumed;

    // Convert case if requested and not a comment
    if (options.cvtcase !== '*NONE' && !input.value.trim().startsWith('/*')) {
      input.value = convertCaseWithQuotes(input.value, fromCase, toCase);
    }

    // Format DCLs to align parameters vertically
    if (input.value.trim().toUpperCase().startsWith('DCL')) {
      input.value = formatDCL(input.value);
    }

    // Write formatted command string
    outputLines.push(...writeFormatted(input.value, sequence, date, level, options));

    const upperInput = input.value.toUpperCase();
    if (upperInput.includes('DO')) {
      level++;
    }
    if (upperInput.includes('ENDDO')) {
      level = Math.max(1, level - 1);
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

function buildCommandString(
  source_data: string,
  allLines: string[],
  idx: number
): { value: string; linesConsumed: number } {
  // Trim trailing whitespace (keep any leading spaces meaningful to expressions)
  let input = source_data.replace(/[ \t]+$/, '');
  let linesConsumed = 0;

  // Always insert exactly one space at each continuation join
  while (input.endsWith('+') || input.endsWith('-')) {
    // Drop the continuation marker
    input = input.slice(0, -1);

    const nextLine = allLines[idx + linesConsumed];
    if (!nextLine) break;

    // CL source data columns
    const nextData = nextLine.substring(12, 92);
    // Remove leading indentation on the next physical line
    const nextTrim = nextData.replace(/^[ \t]+/, '');

    // Ensure a single separator space at the join if not already present
    if (input.length > 0 && input[input.length - 1] !== ' ') {
      input += ' ';
    }

    input += nextTrim;
    linesConsumed++;
  }

  return { value: input, linesConsumed };
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
  sequence: string,
  date: string,
  level: number,
  options: FormatOptions
): string[] {
  // Indent only the first 10 levels
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
        lines.push(sequence + date + indent + ' '.repeat(options.indcont) + chunk);
      } else {
        lines.push(sequence + date + indent + chunk);
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
      lines.push(sequence + date + indent + ' '.repeat(options.indcont) + chunk);
    } else {
      lines.push(sequence + date + indent + chunk);
    }
    prevTail = lastNonSpaceChar(chunk.replace(/[ ]\+$/,''));
    continued = true;
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

