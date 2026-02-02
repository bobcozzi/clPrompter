import { DOMParser } from '@xmldom/xmldom';
import { ParmMeta, ElemMeta, ParsedParms } from './types';


function parseElem(e: Element): ElemMeta {
  // Parse QUALs under ELEM
  const elemQualNodes = Array.from(e.childNodes).filter(n => isElementWithName(n, 'QUAL'));
  const ElemQuals = elemQualNodes.length
    ? elemQualNodes.map(q => ({
      Prompt: q.getAttribute('Prompt') || '',
      Type: q.getAttribute('Type') || undefined
    }))
    : undefined;

  // Parse nested ELEMs under ELEM (recursive)
  const nestedElemNodes = Array.from(e.childNodes)
    .filter(n => n.nodeType === 1 && isElementWithName(n, 'ELEM'))
    .map(n => n as unknown as Element);
  const Elems = nestedElemNodes.length
    ? nestedElemNodes.map(parseElem)
    : undefined;

  return {
    Prompt: e.getAttribute('Prompt') || '',
    Type: e.getAttribute('Type') || undefined,
    Quals: ElemQuals,
    Elems
  };
}

function isElementWithName(n: unknown, name: string): n is { nodeType: number; nodeName: string; getAttribute: (attr: string) => string | null } {
  return !!n && typeof n === 'object'
    && 'nodeType' in n && (n as any).nodeType === 1
    && 'nodeName' in n && typeof (n as any).nodeName === 'string'
    && (n as any).nodeName.toUpperCase() === name.toUpperCase()
    && typeof (n as any).getAttribute === 'function';
}

export function extractParmMetas(xml: string): ParmMeta[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parms = Array.from(doc.getElementsByTagName('Parm')) as unknown as Element[];
  return parms.map(parm => {
    const Kwd = parm.getAttribute('Kwd') || '';
    const Type = parm.getAttribute('Type') || undefined;
    const Max = parm.getAttribute('Max') ? Number(parm.getAttribute('Max')) : undefined;
    const parentPrompt = parm.getAttribute('Prompt') || '';

    const qualNodes = Array.from(parm.childNodes).reduce<Element[]>((acc, n) => {
      if (isElementWithNameQual(n)) acc.push(n);
      return acc;
    }, []);
    const Quals = qualNodes.length
      ? qualNodes.map((q, idx) => ({
        Prompt: idx === 0 ? parentPrompt : (q.getAttribute('Prompt') || ''),
        Type: q.getAttribute('Type') || undefined
      }))
      : undefined;

    const elemNodes = Array.from(parm.childNodes).reduce<Element[]>((acc, n) => {
      if (isElementWithNameElem(n)) acc.push(n);
      return acc;
    }, []);
    const Elems = elemNodes.length
      ? elemNodes.map(parseElem)
      : undefined;
    return { Kwd, Type, Max, Quals, Elems };
  });
}

// Type guards for Elem and Qual
function isElementWithNameElem(n: unknown): n is Element {
  return isElementWithName(n, 'Elem');
}
function isElementWithNameQual(n: unknown): n is Element {
  return isElementWithName(n, 'QUAL');
}



export function splitTopLevelParenGroups(str: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let group = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '(') {
      if (depth === 0) group = ''; // Start a new group
      depth++;
    }
    if (depth > 0) group += c;
    if (c === ')') {
      depth--;
      if (depth === 0) {
        results.push(group.trim());
      }
    }
  }
  return results;
}



export function parseCLParms(
  rawCmd: string,
  parmMetas: ParmMeta[]
): ParsedParms {
  // Remove command name and label if present
  let cmd = rawCmd.trim();
  let labelMatch = cmd.match(/^([A-Z0-9_]+:)\s*/i);
  if (labelMatch) cmd = cmd.slice(labelMatch[0].length);
  let cmdNameMatch = cmd.match(/^([A-Z0-9_\/]+)\s*/i);
  if (cmdNameMatch) cmd = cmd.slice(cmdNameMatch[0].length);

  const paramMap: ParsedParms = {};
  let i = 0;

  while (i < cmd.length) {
    // Skip whitespace
    while (i < cmd.length && /\s/.test(cmd[i])) i++;

    // Find the next keyword
    const kwdMatch = cmd.slice(i).match(/^([A-Z0-9_]+)\s*/i);
    if (!kwdMatch) break;
    const kwd = kwdMatch[1];
    i += kwdMatch[0].length;

    // Skip whitespace
    while (i < cmd.length && /\s/.test(cmd[i])) i++;

    // Find the meta for this keyword
    const meta = parmMetas.find(p => p.Kwd.toUpperCase() === kwd.toUpperCase());
    if (!meta) continue;

    // Parse value for this parameter
    let value: any;
    if (meta.Elems && meta.Elems.length > 0) {
      value = parseElemParam(cmd, i, meta, 1);
      i = value.nextIdx;
      paramMap[kwd] = value.result;
    } else if (meta.Quals && meta.Quals.length > 0) {
      value = parseQualParam(cmd, i, meta);
      i = value.nextIdx;
      paramMap[kwd] = value.result;
    } else {
      value = parseSimpleParam(cmd, i, meta);
      i = value.nextIdx;
      paramMap[kwd] = value.result;
    }
  }
  return paramMap;
}

// --- Helper: Parse a simple (non-ELEM, non-QUAL) parameter ---
function parseSimpleParam(cmd: string, i: number, meta: ParmMeta) {
  let start = i;
  let val = '';
  if (cmd[i] === '(') {
    // Parenthesized value
    let depth = 1;
    i++; // skip '('
    let inSQ = false; // single quote
    let inDQ = false; // double quote
    while (i < cmd.length && depth > 0) {
      const c = cmd[i];

      // Handle quotes
      if (c === "'" && !inDQ) inSQ = !inSQ;
      else if (c === '"' && !inSQ) inDQ = !inDQ;

      // Only count parens when not inside quotes
      if (!inSQ && !inDQ) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
      }

      if (depth > 0) val += c;
      i++;
    }
    val = val.trim();
  } else {
    // Non-parenthesized value: up to next keyword or end
    while (i < cmd.length && !/[\s]/.test(cmd[i])) i++;
    val = cmd.slice(start, i).trim();
  }
  // Always return string[][] format:
  // - Max=1: [[value]]
  // - Max>1: [[val1], [val2], ...]
  if (meta.Max && meta.Max > 1) {
    const vals = splitCLMultiInstance(val);
    return { result: vals.map(v => [v.trim()]), nextIdx: i };
  }
  return { result: [[val.trim()]], nextIdx: i };
}

// --- Helper: Parse a QUAL parameter ---
function parseQualParam(cmd: string, i: number, meta: ParmMeta) {
  let start = i;
  let val = '';
  if (cmd[i] === '(') {
    // Parenthesized value
    let depth = 1;
    i++; // skip '('
    let inSQ = false; // single quote
    let inDQ = false; // double quote
    while (i < cmd.length && depth > 0) {
      const c = cmd[i];

      // Handle quotes
      if (c === "'" && !inDQ) inSQ = !inSQ;
      else if (c === '"' && !inSQ) inDQ = !inDQ;

      // Only count parens when not inside quotes
      if (!inSQ && !inDQ) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
      }

      if (depth > 0) val += c;
      i++;
      // Prevent infinite loop if parentheses are unbalanced
      if (i >= cmd.length && depth > 0) {
        console.warn('Unbalanced parentheses detected in parameter value.');
        break;
      }
    }
    val = val.trim();
  } else {
    // Non-parenthesized value: up to next keyword or end
    while (i < cmd.length && !/[\s]/.test(cmd[i])) i++;
    val = cmd.slice(start, i).trim();
  }
  // Always return string[][] format:
  // - Max=1: [[qual0, qual1]]
  // - Max>1: [[inst0_qual0, inst0_qual1], [inst1_qual0, inst1_qual1], ...]
  if (meta.Max && meta.Max > 1) {
    const vals = splitCLMultiInstance(val);
    return { result: vals.map(v => splitQualValue(v, meta.Quals!.length)), nextIdx: i };
  }
  return { result: [splitQualValue(val, meta.Quals!.length)], nextIdx: i };
}

// Local helpers kept private to this file to avoid collisions
function clp_stripOuterParens(s: string): string {
  const t = s.trim();
  return (t.startsWith('(') && t.endsWith(')')) ? t.slice(1, -1).trim() : t;
}
function clp_splitTopLevelTokens(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let inSQ = false, inDQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDQ) { inSQ = !inSQ; buf += ch; continue; }
    if (ch === '"' && !inSQ) { inDQ = !inDQ; buf += ch; continue; }
    if (!inSQ && !inDQ) {
      if (ch === '(') { depth++; buf += ch; continue; }
      if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; continue; }
      if (/\s/.test(ch) && depth === 0) {
        if (buf.length) { out.push(buf.trim()); buf = ''; }
        continue;
      }
    }
    buf += ch;
  }
  if (buf.length) out.push(buf.trim());
  return out;
}
function clp_findFirstTopLevelParen(s: string): number {
  let depth = 0;
  let inSQ = false, inDQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDQ) { inSQ = !inSQ; continue; }
    if (ch === '"' && !inSQ) { inDQ = !inDQ; continue; }
    if (!inSQ && !inDQ) {
      if (ch === '(') {
        if (depth === 0) return i;
        depth++;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return -1;
}
// QUAL splitter: supports "LIB/OBJ", "*LDA" style, or tokens "OBJ LIB"
function clp_splitQualValue(raw: string, expectedParts: number): string[] {
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith('*')) return [s]; // *LDA, *GDA, *PDA
  if (s.includes('/')) {
    const [lib, obj] = s.split('/').map(t => t.trim());
    // XML order is typically Qual0=Name, Qual1=Library
    return [obj || '', lib || ''].slice(0, Math.max(expectedParts, 2));
  }
  const toks = clp_splitTopLevelTokens(s);
  return toks.slice(0, Math.max(expectedParts, toks.length));
}
// Is this ELEM strictly flat (no QUAL children, no nested ELEM children)?
function clp_isSimpleElem(meta: any): boolean {
  if (!meta?.Elems) return true;
  return meta.Elems.every((e: any) =>
    (!e.Elems || e.Elems.length === 0) &&
    (!e.Quals || e.Quals.length === 0)
  );
}

function parseElemParam(cmd: string, i: number, meta: ParmMeta | ElemMeta, level: number): {
  result: any,
  nextIdx: number
} {
  // Skip whitespace
  while (i < cmd.length && /\s/.test(cmd[i])) i++;

  // Expect a parenthesized group for ELEM
  if (cmd[i] !== '(') return { result: [['']], nextIdx: i };

  // Extract the top-level (...) content
  let depth = 1;
  let start = ++i;
  while (i < cmd.length && depth > 0) {
    const c = cmd[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  const inner = cmd.slice(start, i - 1).trim();

  // Check if this is a Max>1 parameter (only at top level, level=1)
  const isMultiInstance = level === 1 && (meta as ParmMeta).Max && (meta as ParmMeta).Max! > 1;

  if (isMultiInstance) {
    // Split into instances first: (*BEFORE 'text') (*AFTER 'text') -> ["(*BEFORE 'text')", "(*AFTER 'text')"]
    const instances = clp_splitTopLevelInstances(inner);
    const results: string[][] = [];

    for (const inst of instances) {
      // Parse each instance recursively (strip outer parens first)
      const instContent = inst.trim().startsWith('(') && inst.trim().endsWith(')')
        ? inst.trim().slice(1, -1).trim()
        : inst.trim();

      // Parse this single instance
      const singleResult = parseElemParamSingle(instContent, meta);
      results.push(singleResult);
    }

    return { result: results, nextIdx: i };
  }

  // Single instance - parse and wrap in array
  const singleResult = parseElemParamSingle(inner, meta);
  return { result: [singleResult], nextIdx: i };
}

// Helper: Parse a single ELEM instance (not multi-instance)
// Helper: Parse a single ELEM instance (not multi-instance)
function parseElemParamSingle(inner: string, meta: ParmMeta | ElemMeta): string[] {
  // If no children meta, split as plain tokens
  if (!meta || !Array.isArray((meta as any).Elems) || (meta as any).Elems.length === 0) {
    return splitCLMultiInstance ? splitCLMultiInstance(inner) : clp_splitTopLevelTokens(inner);
  }

  const children = (meta as any).Elems as any[];
  const hasQualChild = children.some(c => (c.Type || '').toUpperCase() === 'QUAL');
  const hasNestedElemChild = children.some(c =>
    (c.Type || '').toUpperCase() === 'ELEM' && Array.isArray(c.Elems) && c.Elems.length > 0
  );

  // Simple flat ELEM: split by spaces inside the single paren
  if (!hasQualChild && !hasNestedElemChild) {
    const flat = splitCLMultiInstance ? splitCLMultiInstance(inner) : clp_splitTopLevelTokens(inner);
    return flat;
  }

  // Mixed-list (QUAL and/or nested ELEM children): walk children in order
  let groupStr = inner;
  const results: any[] = [];

  for (const child of children) {
    const childType = (child.Type || '').toUpperCase();

    if (childType === 'QUAL') {
      // Take up to next space or '(' at top-level
      let token = '';
      let j = 0, d = 0, inSQ = false, inDQ = false;
      while (j < groupStr.length) {
        const ch = groupStr[j];
        if (ch === "'" && !inDQ) { inSQ = !inSQ; j++; continue; }
        if (ch === '"' && !inSQ) { inDQ = !inDQ; j++; continue; }
        if (!inSQ && !inDQ) {
          if (ch === '(') break; // stop before nested group
          if (/\s/.test(ch) && d === 0) break;
          if (ch === '(') d++;
          if (ch === ')') d = Math.max(0, d - 1);
        }
        token += ch;
        j++;
      }
      results.push(clp_splitQualValue(token.trim(), Array.isArray(child.Quals) ? child.Quals.length : 2));
      groupStr = groupStr.slice(j).trim();
      continue;
    }

    if (childType === 'ELEM' && Array.isArray(child.Elems) && child.Elems.length > 0) {
      // Find next top-level parenthesized group "( ... )"
      // Skip leading spaces
      let k = 0;
      while (k < groupStr.length && /\s/.test(groupStr[k])) k++;
      if (groupStr[k] !== '(') {
        // Might be SngVal like "*ALL" (container special value)
        // Consume next token and keep it as a single string
        const toks = clp_splitTopLevelTokens(groupStr);
        const special = toks.length ? toks[0] : '';
        if (special) {
          results.push([special]); // keep as single-item array
          groupStr = groupStr.slice(groupStr.indexOf(special) + special.length).trim();
        } else {
          results.push([]);
        }
        continue;
      }
      // Match parentheses
      let d2 = 1, endIdx = k + 1;
      while (endIdx < groupStr.length && d2 > 0) {
        const ch = groupStr[endIdx];
        if (ch === '(') d2++;
        else if (ch === ')') d2--;
        endIdx++;
      }
      const subInner = groupStr.slice(k + 1, endIdx - 1).trim();

      if (clp_isSimpleElem(child)) {
        // Split directly into child leaf values
        const tokens = splitCLMultiInstance ? splitCLMultiInstance(subInner) : clp_splitTopLevelTokens(subInner);
        results.push(tokens);
      } else {
        // Recurse for nested ELEM
        const rec = parseElemParamSingle(subInner, child);
        results.push(rec);
      }

      groupStr = groupStr.slice(endIdx).trim();
      continue;
    }

    // Leaf value inside a complex group: take next token
    const toks = clp_splitTopLevelTokens(groupStr);
    const leaf = toks.length ? toks[0] : '';
    results.push(leaf);
    if (leaf) {
      const pos = groupStr.indexOf(leaf);
      groupStr = groupStr.slice(pos + leaf.length).trim();
    }
  }

  return results;
}

// Helper: Split top-level parenthesized instances
// e.g., "(*BEFORE 'text') (*AFTER 'text')" -> ["(*BEFORE 'text')", "(*AFTER 'text')"]
function clp_splitTopLevelInstances(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let inSQ = false, inDQ = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDQ) { inSQ = !inSQ; buf += ch; continue; }
    if (ch === '"' && !inSQ) { inDQ = !inDQ; buf += ch; continue; }
    if (!inSQ && !inDQ) {
      if (ch === '(') {
        if (depth === 0 && buf.trim().length > 0) {
          out.push(buf.trim());
          buf = '';
        }
        depth++;
        buf += ch;
        continue;
      }
      if (ch === ')') {
        depth = Math.max(0, depth - 1);
        buf += ch;
        if (depth === 0 && buf.trim().length > 0) {
          out.push(buf.trim());
          buf = '';
        }
        continue;
      }
      if (/\s/.test(ch) && depth === 0) {
        if (buf.trim().length > 0) {
          out.push(buf.trim());
          buf = '';
        }
        continue;
      }
    }
    buf += ch;
  }

  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}


function splitQualValue(val: string, numQuals: number): string[] {
  if (val.startsWith('(') && val.endsWith(')')) val = val.slice(1, -1).trim();
  const parts = val.split('/').map(s => s.trim()).filter(Boolean);
  // Reverse so rightmost is first, then pad to numQuals
  const reversed = parts.reverse();
  while (reversed.length < numQuals) reversed.push('');
  return reversed;
}

// --- Helper: Split multi-instance values, respecting quotes/parentheses ---
function splitCLMultiInstance(val: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < val.length; i++) {
    const c = val[i];
    if (c === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (c === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (!inSingleQuote && !inDoubleQuote) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ' ' && depth === 0) {
        if (current.trim()) result.push(current.trim());
        current = '';
        continue;
      }
    }
    current += c;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}