import { CLParm, CLElem, CLQual, ParmMeta, ParmValues, QualPartsMap } from './types';

import * as promptHelpers from './promptHelpers.js';

export function isContainerType(type: string | null | undefined): boolean {
    if (!type) return false;
    const t = type.toUpperCase();
    return t === 'ELEM' || t === 'QUAL' || t === 'CONTAINER';
}

// ...existing code...
export function populateQualInputs(
    parm: Element | null,
    parmMeta: ParmMeta,
    kwd: string,
    vals: string | string[] | null | undefined,
    instanceIdx: number = 0,
    container: Document = document
): void {
    const quals = parmMeta.Quals || [];
    let parts: string[] = [];

    if (Array.isArray(vals)) {
        parts = vals as string[];
    } else if (typeof vals === "string") {
        parts = (promptHelpers && typeof promptHelpers.splitCLQual === "function")
            ? promptHelpers.splitCLQual(vals)
            : vals.split("/");
    }

    for (let i = 0; i < parts.length; i++) {
        console.log(`${kwd} Parts Dump: Parts[${i}] = ${parts[i]}`);
    }

    // Left-pad so the rightmost token maps to QUAL0
    while (parts.length < quals.length) parts.unshift("");

    for (let q = 0; q < quals.length; q++) {
        const partIdx = parts.length - 1 - q;         // compute index first
        const value = parts[partIdx] ?? "";           // then read it

        const qualName = instanceIdx > 0 ? `${kwd}_QUAL${q}_${instanceIdx}` : `${kwd}_QUAL${q}`;
        let input = container.querySelector(`[name="${qualName}"]`) as HTMLInputElement | HTMLSelectElement | Element | null;
        if (!input) input = container.querySelector(`vscode-single-select[name="${qualName}"]`);
        if (!input) input = container.querySelector(`select[name="${qualName}"]`);
        if (!input) input = container.querySelector(`#${qualName}_custom`);

        console.log(`[clPrompter] QUAL Value Applied: kwd=${qualName}, q=${q}, partIdx=${partIdx}, value="${value}"`);

        if (input) {
            const tag = (input as Element).tagName ? (input as Element).tagName.toLowerCase() : "";
            if (tag === 'vscode-single-select') {
                // Ensure custom value sticks in the combobox
                const selectEl = input as Element;
                const exists = !!selectEl.querySelector(`vscode-option[value="${value}"]`);
                if (!exists && value) {
                    const opt = document.createElement("vscode-option");
                    opt.setAttribute("value", value);
                    opt.textContent = value;
                    opt.setAttribute("data-custom", "true");
                    selectEl.appendChild(opt);
                }
                (selectEl as any).value = value;
            } else if (tag === 'select') {
                let foundIdx = -1;
                const selectElem = input as HTMLSelectElement;
                for (let i = 0; i < selectElem.options.length; i++) {
                    if (selectElem.options[i].value.trim().toUpperCase() === value.trim().toUpperCase()) {
                        foundIdx = i;
                        break;
                    }
                }
                if (foundIdx !== -1) {
                    selectElem.selectedIndex = foundIdx;
                    const customInput = container.querySelector(`#${qualName}_custom`) as HTMLInputElement | null;
                    if (customInput) customInput.value = "";
                } else {
                    selectElem.selectedIndex = -1;
                    const customInput = container.querySelector(`#${qualName}_custom`) as HTMLInputElement | null;
                    if (customInput) customInput.value = value;
                }
            } else {
                (input as HTMLInputElement).value = value;
            }
        }
    }
}



export function populateElemInputs(
    parm: CLParm,
    parmMeta: ParmMeta,
    kwd: string,
    vals: any,
    instanceIdx: number = 0,
    container: Document = document
): void {
    // Helper: Recursively populate ELEM/QUAL fields
    function populate(elems: any[], baseName: string, values: any, depth = 0) {
        console.log(`[clPrompter] populate: baseName=${baseName}, depth=${depth}, elems=`, elems, 'values=', values);

        if (depth > 3) {
            console.warn(`[clPrompter] Max ELEM recursion depth reached for ${baseName}`);
            return;
        }
        if (!Array.isArray(elems) || elems.length === 0) return;
        // Defensive: If values is not array, make it one
        if (!Array.isArray(values)) values = [values];
        for (let e = 0; e < elems.length; e++) {
            const elem = elems[e];
            const elemType = (elem.Type || '').toUpperCase();
            const elemName = baseName + `_ELEM${e}` + (instanceIdx > 0 ? `_${instanceIdx}` : '');
            const value = values[e] !== undefined ? values[e] : elem.Dft ?? '';
            if (elemType === "QUAL" && Array.isArray(elem.Quals)) {
                // QUAL: value is array or string
                populateQualInputs(
                    null,
                    elem,      // pass the actual QUAL meta
                    elemName,
                    value,
                    instanceIdx,
                    container
                );
            } else if (elemType === "ELEM" && Array.isArray(elem.Elems)) {
                // Nested ELEM: value is array or string
                populate(elem.Elems, elemName, value, depth + 1);
            } else {
                // Simple value: assign directly
                const input = container.querySelector(`[name="${elemName}"]`) as HTMLInputElement | HTMLSelectElement | null;
                if (input) input.value = value;
            }
        }
    }

    // Start recursion with top-level elems and vals
    const elems = parm.Elems || parmMeta.Elems || [];
    populate(elems, kwd, vals, 0);
}



// Populate ELEM inputs for a parameter, including nested ELEM/QUAL and SngVal support

/**
 * Assembles qualified parameter values in LIFO order.
 * For each entry in qualPartsMap, filters out empty/missing parts,
 * reverses the order, and joins with '/'.
 * Example: [Q1, Q2, Q3] => "Q3/Q2/Q1" (if all present)
 */
export function assembleQualParms(
    values: Record<string, any>,
    qualPartsMap: Record<string, (string | undefined | null)[]>
): void {
    for (const [parmName, parts] of Object.entries(qualPartsMap)) {
        if (!Array.isArray(parts) || parts.length === 0) {
            continue; // Skip if parts is not an array or is empty
        }
        // Filter out missing/empty parts
        const filtered = parts
            .filter(p => typeof p === "string" && p.trim() !== "")
            .map(p => (p as string).trim());

        // Reverse for LIFO order (rightmost first)
        const lifo = filtered.reverse();

        if (lifo.length > 0) {
            values[parmName] = lifo.join("/");
        }
    }
}

export function assembleElemParms(
    values: ParmValues,
    parms: Element[],
    originalParmMap?: ParmValues,
    getElemOrQualValue?: (elem: Element, elemName: string, container: Document) => string
): void {
    if (!Array.isArray(parms) || parms.length === 0) {
        // Optionally log or handle the case where parms is missing
        return;
    }
    for (let i = 0; i < parms.length; i++) {
        const parm = parms[i];
        const kwd = parm.getAttribute("Kwd") || "";
        const type = (parm.getAttribute("Type") || "").toUpperCase();
        const isMultiGroup = !!document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);

        if (type === "ELEM" && !isMultiGroup) {
            // SngVal check
            const sngValInput = document.querySelector(`[name="${kwd}_SNGVAL"]`) as HTMLSelectElement | null;
            if (sngValInput && sngValInput.value) {
                const selectedOption = sngValInput.selectedOptions[0];
                if (selectedOption && selectedOption.getAttribute("data-sngval") === "true") {
                    if (!isUnchangedDefault(sngValInput, sngValInput.value)) {
                        values[kwd] = [sngValInput.value];
                    }
                    continue;
                }
            }

            // No SngVal selected - process ELEM values normally
            const elems = parm.getElementsByTagName("Elem");
            let elemVals: string[] = [];
            for (let e = 0; e < elems.length; e++) {
                const elemName = `${kwd}_ELEM${e}`;
                const elem = elems[e];
                let val = "";
                if (getElemOrQualValue) {
                    val = getElemOrQualValue(elem, elemName, document);
                }
                if (val && val.trim() !== "") elemVals.push(val);
            }
            // Remove trailing unchanged defaults
            while (elemVals.length > 0) {
                const lastIdx = elemVals.length - 1;
                const elemName = `${kwd}_ELEM${lastIdx}`;
                const input = document.querySelector(`[name="${elemName}"]`) as HTMLInputElement | null;
                if (!input) break;
                const val = elemVals[lastIdx];
                if (isUnchangedDefault(input, val)) {
                    elemVals.pop();
                } else {
                    break;
                }
            }
            if (elemVals.length > 0) {
                values[kwd] = elemVals;
            } else if (originalParmMap && Object.prototype.hasOwnProperty.call(originalParmMap, kwd)) {
                let orig = originalParmMap[kwd];
                if (Array.isArray(orig)) {
                    values[kwd] = orig;
                } else if (typeof orig === "string") {
                    values[kwd] = orig.trim().split(/\s+/);
                } else {
                    values[kwd] = [String(orig)];
                }
            }
        }
    }
}

export function isUnchangedDefault(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element,
    value: string,
    originalParmMap?: Record<string, any>
): boolean {
    // 1. Always include if user modified
    if (input.getAttribute('data-modified') === 'true') return false;

    // 2. Always include if present in original command (by full name for ELEM, by base for simple)
    const name = input.getAttribute('name') || input.id;
    const baseName = name.split('_')[0];
    if (originalParmMap && (originalParmMap.hasOwnProperty(name) || originalParmMap.hasOwnProperty(baseName))) return false;

    // 3. Compare to default (case-insensitive, trimmed, treat undefined/empty as equal)
    const defaultValue = input.getAttribute('data-default');
    const val = (value || '').trim().toUpperCase();
    const def = (defaultValue || '').trim().toUpperCase();
    if (val === def) return true;

    // 4. If both are empty, treat as unchanged
    if (!val && !def) return true;

    // 5. For QUAL, never skip due to default (handled elsewhere)
    if (name.includes('_QUAL')) return false;

    return false;
}

export function validateRangeInput(
    input: HTMLInputElement | HTMLTextAreaElement | Element,
    allowedValsMap: Record<string, string[]> = {},
    tooltips?: any // If you have a tooltip helper, pass it in
): boolean {
    const fromValue = input.getAttribute('data-range-from');
    const toValue = input.getAttribute('data-range-to');

    if (!fromValue || !toValue) return true; // No range to validate

    const value = (input as HTMLInputElement).value?.trim() || "";

    // Allow empty values (they're optional)
    if (!value) return true;

    // Check if value matches any allowed special value
    const inputName = input.getAttribute('name') || input.id;
    const allowedVals = allowedValsMap[inputName] || [];
    if (allowedVals.includes(value)) return true;

    // Allow any value that starts with * (special values)
    if (value.startsWith('*')) return true;

    // Allow any value that starts with & (CL variables)
    if (value.startsWith('&')) return true;

    // Validate numeric range
    const numValue = parseInt(value, 10);
    const fromNum = parseInt(fromValue, 10);
    const toNum = parseInt(toValue, 10);

    if (isNaN(numValue) || isNaN(fromNum) || isNaN(toNum)) return true; // Can't validate non-numeric, assume valid

    const isValid = numValue >= fromNum && numValue <= toNum;

    if (!isValid) {
        (input as HTMLElement).classList.add('invalid');
        if (tooltips && typeof tooltips.showRangeTooltip === 'function') {
            tooltips.showRangeTooltip(input, `❌ Value ${value} is outside valid range ${fromValue}-${toValue}`, 'error');
        }
        return false;
    } else {
        (input as HTMLElement).classList.remove('invalid');
        return true;
    }
}
export function getDefaultValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element
): string {
    // Check data-default attribute first
    const dataDefault = input.getAttribute('data-default');
    if (dataDefault) return dataDefault;

    // Check if it's a select with a default option
    const tag = input.tagName.toUpperCase();
    if (tag === 'SELECT' || tag === 'VSCODE-DROPDOWN') {
        const defaultOption =
            (input as HTMLSelectElement).querySelector('option[selected]') ||
            (input as Element).querySelector('vscode-option[selected]');
        if (defaultOption && (defaultOption as HTMLOptionElement).value) {
            return (defaultOption as HTMLOptionElement).value;
        }
    }

    // For other inputs, check the default value property
    if ('defaultValue' in input) {
        return (input as HTMLInputElement | HTMLTextAreaElement).defaultValue || '';
    }

    return '';
}

export function getInputValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element
): string {
    if (!input) return '';
    const tag = input.tagName.toLowerCase();

    if (tag === 'vscode-textarea' || tag === 'textarea') {
        return (input as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' ');
    }

    if (tag === 'vscode-single-select') {
        return (input as any).value || '';
    }

    if (tag === 'vscode-textfield') {
        return (input as any).value || '';
    }

    // Handle old dropdown with custom input
    if (tag === 'select' && (input as HTMLSelectElement).dataset.customInputId) {
        const customInputId = (input as HTMLSelectElement).dataset.customInputId;
        const customInput = customInputId ? document.getElementById(customInputId) : null;
        if (customInput && (customInput as HTMLInputElement).value.trim() !== "") {
            return (customInput as HTMLInputElement).value.trim();
        } else {
            return (input as HTMLSelectElement).value;
        }
    }

    // Regular input
    return (input as HTMLInputElement).value || '';
}

