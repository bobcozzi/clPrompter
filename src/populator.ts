
import { DOMParser, Element as XMLElement, Node as XMLNode } from '@xmldom/xmldom';

export interface ParameterMap {
  [key: string]: string | string[] | ParameterMap;
}

export interface PopulationOptions {
  debugMode?: boolean;
  skipDefaults?: boolean;
}

/**
 * Check if a CL value is an expression that should be treated as a single unit
 */
function isCLExpression(val: string): boolean {
  const ops = ['*CAT', '*TCAT', '*BCAT', '*EQ', '*NE', '*LT', '*LE', '*GT', '*GE'];
  const trimmed = val.trim().toUpperCase();

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true;
  if (ops.some(op => trimmed.includes(op))) return true;
  if (/%[A-Z][A-Z0-9]*\s*\(/i.test(trimmed)) return true;
  if (/&[A-Z][A-Z0-9]*\s*[*%]/i.test(trimmed)) return true;

  return false;
}

/**
 * Split CL qualified values on unquoted forward slashes
 */
function splitCLQual(val: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false, inDouble = false, parenDepth = 0;

  for (let i = 0; i < val.length; i++) {
    const c = val[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '/' && !inSingle && !inDouble && parenDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    if (c === '(' && !inSingle && !inDouble) parenDepth++;
    else if (c === ')' && !inSingle && !inDouble && parenDepth > 0) parenDepth--;
    current += c;
  }
  parts.push(current);
  return parts;
}

/**
 * Flatten parameter values into consistent array format
 */
function flattenParmValue(val: any): string[] {
  if (typeof val === "string") {
    return [val];
  }
  if (Array.isArray(val)) {
    if (val.length > 0 && Array.isArray(val[0])) {
      return val.map(sub => Array.isArray(sub) ? sub.join("/") : sub);
    }
    return val;
  }
  return [];
}

/**
 * Population instructions for webview to execute
 */
export interface PopulationInstruction {
  type: 'elem' | 'qual' | 'simple' | 'multi-instance';
  target: string;
  value: string | string[];
  method: 'vscode-select' | 'vscode-textfield' | 'html-select-custom' | 'regular-input' | 'click';
  options?: {
    shadowDOMAccess?: boolean;
    forceValue?: boolean;
    dispatchEvents?: boolean;
  };
}

/**
 * Generate population instructions for a multi-instance parameter
 */
function generateElemInstructions(
  kwd: string,
  vals: any,
  instanceIdx: number = 0,
  isMultiInstance: boolean = false,
  options: PopulationOptions = {}
): PopulationInstruction[] {
  const instructions: PopulationInstruction[] = [];

  console.log(`[generateElemInstructions] ${kwd} - ENTRY`);
  console.log(`[generateElemInstructions] ${kwd} - instanceIdx: ${instanceIdx}`);
  console.log(`[generateElemInstructions] ${kwd} - isMultiInstance: ${isMultiInstance}`);
  console.log(`[generateElemInstructions] ${kwd} - vals:`, vals);

  // ✅ Handle mixed array structure (simple values + nested arrays)
  if (Array.isArray(vals)) {
    console.log(`[generateElemInstructions] ${kwd} - Processing array with ${vals.length} elements`);

    for (let e = 0; e < vals.length; e++) {
      const elemValue = vals[e];
      // Always use INST naming to maintain 2D array structure consistency
      const elemName = `${kwd}_INST${instanceIdx}_ELEM${e}`;

      console.log(`[generateElemInstructions] ${kwd} - Element ${e}:`);
      console.log(`[generateElemInstructions] ${kwd} -   elemValue:`, elemValue);
      console.log(`[generateElemInstructions] ${kwd} -   isMultiInstance: ${isMultiInstance}`);
      console.log(`[generateElemInstructions] ${kwd} -   elemName: "${elemName}"`);
      console.log(`[generateElemInstructions] ${kwd} -   elemValue is array: ${Array.isArray(elemValue)}`);

      // ✅ Handle nested ELEM (array within array)
      if (Array.isArray(elemValue)) {
        console.log(`[generateElemInstructions] ${kwd} - Processing nested array for element ${e}:`, elemValue);

        // Check if this is a QUAL element (qualified name with 2 parts)
        // QUAL arrays have exactly 2 string elements (library/file or similar)
        const isQualElement = elemValue.length === 2 &&
                              elemValue.every(v => typeof v === 'string' || v === '');

        if (isQualElement) {
          console.log(`[generateElemInstructions] ${kwd} - Detected QUAL element, creating QUAL instructions`);
          // Create QUAL instructions with proper naming: RMTFILE_INST0_ELEM0_QUAL0, etc.
          for (let q = 0; q < elemValue.length; q++) {
            const qualValue = elemValue[q];
            const qualName = `${elemName}_QUAL${q}`;

            instructions.push({
              type: 'qual',
              target: qualName,
              value: qualValue || '',
              method: 'vscode-select',
              options: {
                shadowDOMAccess: true,
                forceValue: true,
                dispatchEvents: true
              }
            });

            console.log(`[generateElemInstructions] ${kwd} - Added QUAL instruction: ${qualName} = "${qualValue}"`);
          }
        } else {
          // Regular nested ELEM (not a QUAL)
          for (let se = 0; se < elemValue.length; se++) {
            const subValue = elemValue[se];
            if (subValue && subValue.toString().trim() !== '') {
              const subElemName = `${elemName}_${se}`;

              instructions.push({
                type: 'elem',
                target: subElemName,
                value: subValue,
                method: 'vscode-select',
                options: { forceValue: true, dispatchEvents: true }
              });

              console.log(`[generateElemInstructions] ${kwd} - Added nested ELEM instruction: ${subElemName} = "${subValue}"`);
            }
          }
        }
      }
      // ✅ NEW: Handle strings with parentheses (like "(KPOP COZTOOLS)")
      else if (typeof elemValue === 'string' && elemValue.includes('(') && elemValue.includes(')')) {
        console.log(`[generateElemInstructions] ${kwd} - Element ${e} is string with parentheses: "${elemValue}"`);

        let cleanValue = elemValue.trim();
        if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
          cleanValue = cleanValue.slice(1, -1);
          console.log(`[generateElemInstructions] ${kwd} - Stripped parentheses: "${elemValue}" -> "${cleanValue}"`);
        }

        const subValues = cleanValue.split(' ').filter(v => v.trim() !== '');
        console.log(`[generateElemInstructions] ${kwd} - Parsed sub-values:`, subValues);

        for (let se = 0; se < subValues.length; se++) {
          const subValue = subValues[se];
          if (subValue && subValue.trim() !== '') {
            const subElemName = `${elemName}_${se}`;

            instructions.push({
              type: 'elem',
              target: subElemName,
              value: subValue,
              method: 'vscode-select',
              options: { forceValue: true, dispatchEvents: true }
            });

            console.log(`[generateElemInstructions] ${kwd} - Added parsed nested ELEM instruction: ${subElemName} = "${subValue}"`);
          }
        }
      }
      // ✅ Handle simple ELEM value
      else if (elemValue && elemValue.toString().trim() !== '') {
        instructions.push({
          type: 'elem',
          target: elemName,
          value: elemValue,
          method: 'vscode-select',
          options: { forceValue: true, dispatchEvents: true }
        });

        console.log(`[generateElemInstructions] ${kwd} - Added simple ELEM instruction: ${elemName} = "${elemValue}"`);
      }
    }
  }

  // ✅ Handle string values (legacy support)
  else if (typeof vals === 'string') {
    let splitVals: string[];
    if (isCLExpression(vals)) {
      splitVals = [vals];
    } else {
      splitVals = vals.split(' ');
    }

    console.log(`[clPrompter] ${kwd} - Split string ELEM values:`, splitVals);

    for (let e = 0; e < splitVals.length; e++) {
      const elemName = isMultiInstance ? `${kwd}_ELEM${e}_${instanceIdx}` : `${kwd}_ELEM${e}`;
      const value = splitVals[e];

      if (value && value.trim() !== '') {
        // ✅ Handle parenthesized groups in string format
        if (value.includes('(') && value.includes(')')) {
          let cleanValue = value.trim();

          if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
            cleanValue = cleanValue.slice(1, -1);
            console.log(`[clPrompter] ${kwd} - Stripped parentheses: "${value}" -> "${cleanValue}"`);
          }

          const subValues = cleanValue.split(' ').filter(v => v.trim() !== '');

          for (let se = 0; se < subValues.length; se++) {
            const subValue = subValues[se];
            if (subValue && subValue.trim() !== '') {
              // ✅ FIXED: Remove the hardcoded _0_ from string parsing too
              const subElemName = `${elemName}_${se}`;

              instructions.push({
                type: 'elem',
                target: subElemName,
                value: subValue,
                method: 'vscode-select',
                options: { forceValue: true, dispatchEvents: true }
              });

              console.log(`[clPrompter] ${kwd} - Added string-parsed nested ELEM: ${subElemName} = "${subValue}"`);
            }
          }
        } else {
          // Regular element from string
          instructions.push({
            type: 'elem',
            target: elemName,
            value: value,
            method: 'vscode-select',
            options: { forceValue: true, dispatchEvents: true }
          });

          console.log(`[clPrompter] ${kwd} - Added string ELEM instruction: ${elemName} = "${value}"`);
        }
      }
    }
  }

  console.log(`[clPrompter] ${kwd} - Generated ${instructions.length} ELEM instructions`);
  return instructions;
}

/**
 * Generate population instructions for QUAL parameters
 */
function generateQualInstructions(
  kwd: string,
  vals: any,
  options: PopulationOptions = {}
): PopulationInstruction[] {
  const instructions: PopulationInstruction[] = [];

  let parts: string[];
  if (Array.isArray(vals)) {
    parts = vals;
  } else if (typeof vals === "string") {
    parts = splitCLQual(vals);
  } else {
    parts = [];
  }

  console.log(`[clPrompter] ${kwd} - Processing QUAL parameter, parts:`, parts);

  for (let q = 0; q < parts.length; q++) {
    const qName = `${kwd}_QUAL${q}`;
    // Use natural order: QUAL0 gets parts[0], QUAL1 gets parts[1], etc.
    const value = parts[q] !== undefined ? parts[q] : "";

    console.log(`[clPrompter] ${kwd} - QUAL${q}: qName=${qName}, value="${value}"`);

    instructions.push({
      type: 'qual',
      target: qName,
      value: value,
      method: 'vscode-select',
      options: {
        shadowDOMAccess: true,
        forceValue: true,
        dispatchEvents: true
      }
    });
  }

  return instructions;
}

/**
 * Generate population instructions for simple parameters
 */
function generateSimpleInstructions(
  kwd: string,
  vals: any,
  options: PopulationOptions = {}
): PopulationInstruction[] {
  const value = Array.isArray(vals) ? vals[0] : vals;

  console.log(`[clPrompter] ${kwd} - Processing simple parameter, value:`, value);

  return [{
    type: 'simple',
    target: kwd,
    value: value,
    method: 'vscode-select',
    options: { forceValue: true, dispatchEvents: true }
  }];
}


/**
 * Generate population instructions for multi-instance parameters (Max > 1)
 */
function generateMultiInstanceInstructions(
  kwd: string,
  vals: any,
  xmlContent: string,
  paramMap: ParameterMap,
  options: PopulationOptions = {}
): PopulationInstruction[] {
  const instructions: PopulationInstruction[] = [];

  console.log(`[generateMultiInstanceInstructions] ${kwd} - ENTRY`);
  console.log(`[generateMultiInstanceInstructions] ${kwd} - vals:`, vals);

  // Parse XML to get parameter definition
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
  const parm = Array.from(xmlDoc.getElementsByTagName("Parm")).find(p =>
    p.getAttribute("Kwd") === kwd
  );

  if (!parm) {
    console.log(`[generateMultiInstanceInstructions] ${kwd} - Parameter not found in XML`);
    return instructions;
  }

  const maxInstances = parseInt(parm.getAttribute("Max") || "1", 10);
  const hasElems = parm.getElementsByTagName("Elem").length > 0;
  const hasQuals = parm.getElementsByTagName("Qual").length > 0;

  console.log(`[generateMultiInstanceInstructions] ${kwd} - maxInstances: ${maxInstances}`);
  console.log(`[generateMultiInstanceInstructions] ${kwd} - hasElems: ${hasElems}`);
  console.log(`[generateMultiInstanceInstructions] ${kwd} - hasQuals: ${hasQuals}`);

  // Ensure vals is an array for multi-instance processing
  const valuesArray = Array.isArray(vals) ? vals : [vals];
  console.log(`[generateMultiInstanceInstructions] ${kwd} - valuesArray:`, valuesArray);

  // First, add instructions to create additional instances if needed
  for (let i = 1; i < valuesArray.length && i < maxInstances; i++) {
    instructions.push({
      type: 'multi-instance',
      target: `.parm-multi-group[data-kwd="${kwd}"] .add-parm-btn`,
      value: 'click',
      method: 'click', // changed from multi-instance to click
      options: {
        forceValue: true,
        dispatchEvents: true
      }
    });

    console.log(`[generateMultiInstanceInstructions] ${kwd} - Added click instruction for instance ${i}`);
  }

  // Then populate each instance
  valuesArray.forEach((instanceValue, instanceIndex) => {
    if (instanceIndex >= maxInstances) {
      console.log(`[generateMultiInstanceInstructions] ${kwd} - Skipping instance ${instanceIndex} (exceeds max ${maxInstances})`);
      return;
    }

    console.log(`[generateMultiInstanceInstructions] ${kwd} - Processing instance ${instanceIndex}:`, instanceValue);

    if (hasElems) {
      // Multi-instance ELEM parameter
      console.log(`[generateMultiInstanceInstructions] ${kwd} - Processing as multi-instance ELEM`);
      instructions.push(...generateElemInstructions(kwd, instanceValue, instanceIndex, true, options));
    } else if (hasQuals) {
      // Multi-instance QUAL parameter
      console.log(`[generateMultiInstanceInstructions] ${kwd} - Processing as multi-instance QUAL`);
      const qualInstructions = generateQualInstructions(`${kwd}_${instanceIndex}`, instanceValue, options);
      instructions.push(...qualInstructions);
    } else {
      // Multi-instance simple parameter
      console.log(`[generateMultiInstanceInstructions] ${kwd} - Processing as multi-instance simple`);
      const targetName = instanceIndex === 0 ? kwd : `${kwd}_${instanceIndex}`;

      if (instanceValue && instanceValue.toString().trim() !== '') {
        instructions.push({
          type: 'simple',
          target: targetName,
          value: instanceValue,
          method: 'vscode-select',
          options: {
            forceValue: true,
            dispatchEvents: true
          }
        });

        console.log(`[generateMultiInstanceInstructions] ${kwd} - Added simple instruction: ${targetName} = "${instanceValue}"`);
      }
    }
  });

  console.log(`[generateMultiInstanceInstructions] ${kwd} - Generated ${instructions.length} instructions`);
  return instructions;
}

/**
 * Main function to generate all population instructions
 */
export function generatePopulationInstructions(
  paramMap: ParameterMap,
  xmlContent: string,
  options: PopulationOptions = {}
): PopulationInstruction[] {
  console.log("[clPrompter] ===== generatePopulationInstructions START =====");
  console.log("[clPrompter] paramMap received:", paramMap);
  console.log("[clPrompter] paramMap type:", typeof paramMap);
  console.log("[clPrompter] paramMap keys:", paramMap ? Object.keys(paramMap) : "paramMap is null/undefined");

  const instructions: PopulationInstruction[] = [];

  // Check if paramMap is empty or null
  if (!paramMap || Object.keys(paramMap).length === 0) {
    console.log("[clPrompter] paramMap is empty or null - returning empty instructions");
    return instructions;
  }

  // Parse XML to determine parameter types
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
  const parms = Array.from(xmlDoc.getElementsByTagName("Parm"));

  console.log("[clPrompter] Starting to iterate over parameters...");

  for (const [kwd, vals] of Object.entries(paramMap)) {
    console.log("[clPrompter] ===== Processing parameter =====");
    console.log("[clPrompter] kwd:", kwd);
    console.log("[clPrompter] vals:", vals);
    console.log("[clPrompter] vals type:", typeof vals);
    console.log("[clPrompter] vals is array:", Array.isArray(vals));

    // Find parameter definition in XML
    const parm = parms.find(p => p.getAttribute("Kwd") === kwd);
    if (!parm) {
      console.log(`[clPrompter] ${kwd} - Parameter not found in XML, skipping`);
      continue;
    }

    const maxInstances = parseInt(parm.getAttribute("Max") || "1", 10);
    const isMultiInstance = maxInstances > 1;
    const hasElems = parm.getElementsByTagName("Elem").length > 0;
    const hasQuals = parm.getElementsByTagName("Qual").length > 0;

    if (isMultiInstance) {
      // Multi-instance parameter
      instructions.push(...generateMultiInstanceInstructions(kwd, vals, xmlContent, paramMap, options));
    } else if (hasElems) {
      // ELEM parameter (single instance)
      // For single-instance ELEM parameters, vals is [[elem0, elem1, ...]]
      // We need to pass vals[0] (the elements array) to generateElemInstructions
      const elemValues = Array.isArray(vals) && vals.length > 0 ? vals[0] : vals;
      instructions.push(...generateElemInstructions(kwd, elemValues, 0, false, options));
    } else if (hasQuals) {
      // QUAL parameter (single instance)
      instructions.push(...generateQualInstructions(kwd, vals, options));
    } else {
      // Simple parameter (single instance)
      instructions.push(...generateSimpleInstructions(kwd, vals, options));
    }
  }

  console.log("[clPrompter] ===== generatePopulationInstructions END =====");
  console.log(`[clPrompter] Generated ${instructions.length} population instructions`);

  if (options.debugMode) {
    console.log("[clPrompter] Population instructions:", instructions);
  }

  return instructions;
}

/**
 * Legacy function name for backward compatibility
 * @deprecated Use generatePopulationInstructions instead
 */
export function populateForm(
  paramMap: ParameterMap,
  xmlContent: string,
  options: PopulationOptions = {}
): PopulationInstruction[] {
  console.warn('[clPrompter] populateForm is deprecated, use generatePopulationInstructions instead');
  return generatePopulationInstructions(paramMap, xmlContent, options);
}

/**
 * Utility functions for webview consumption
 */
export const PopulationUtils = {
  isCLExpression,
  splitCLQual,
  flattenParmValue
};