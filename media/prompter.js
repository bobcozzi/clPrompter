import { getDefaultLengthForType, flattenParmValue, parseSpaceSeparatedValues, getLengthClass } from './promptHelpers.js';
// Global state (typed)
let state = {
    xmlDoc: null,
    parms: [],
    allowedValsMap: {},
    originalParmMap: {},
    cmdName: '',
    hasProcessedFormData: false,
    controlsWired: false,
    parmMetas: {}
};
const vscode = typeof window !== 'undefined' ? window.vscodeApi : undefined;
// Helper: Check if restricted
function isRestricted(el) {
    const rstd = el?.getAttribute('Rstd');
    return rstd === 'YES' || rstd === 'Y' || rstd === '*YES' || rstd === '1' || rstd === 'TRUE';
}
// Ensure inputs are wide enough to display content and XML sizing hints.
// Uses 'ch' units so width matches character counts.
function ensureMinInputWidth(el, opts = {}) {
    const anyEl = el;
    const tag = String(anyEl.tagName || '').toLowerCase();
    const type = String(anyEl.type || '').toLowerCase();
    // Skip width adjustments for textareas - they have their own CSS sizing
    if (tag === 'textarea') {
        return;
    }
    const current = String(anyEl.value ?? '');
    const valueLen = Math.max(opts.valueLen ?? 0, current.length);
    const len = Number.isFinite(opts.len) ? opts.len : 0;
    const inl = Number.isFinite(opts.inlPmtLen) ? opts.inlPmtLen : 0;
    const minCh = Math.max(4, len, inl, valueLen);
    // Only set 'size' for text-like inputs, NEVER for <select> (setting size > 1 turns it into a list box)
    if (tag === 'input' && (type === 'text' || type === 'search' || type === 'email' || type === 'url')) {
        if ('size' in anyEl && typeof anyEl.size === 'number') {
            anyEl.size = minCh;
        }
    }
    // Width hint for all controls (select, input, etc.)
    el.style.minWidth = `calc(${minCh}ch + 2px)`;
}
// Call once after receiving formData to apply the configured keyword and value colors (if provided)
function applyConfigStyles(config) {
    if (!config)
        return;
    const { keywordColor, valueColor, autoAdjust = true } = config;
    if (keywordColor) {
        if (autoAdjust) {
            // Apply theme-aware keyword color
            document.documentElement.style.setProperty('--clp-kwd-color', keywordColor);
            document.documentElement.style.setProperty('--clp-kwd-color-light', adjustColorForTheme(keywordColor, 'light'));
            document.documentElement.style.setProperty('--clp-kwd-color-dark', adjustColorForTheme(keywordColor, 'dark'));
            document.documentElement.style.setProperty('--clp-kwd-color-hc', adjustColorForTheme(keywordColor, 'high-contrast'));
        }
        else {
            // Use exact color for all themes
            document.documentElement.style.setProperty('--clp-kwd-color', keywordColor);
            document.documentElement.style.setProperty('--clp-kwd-color-light', keywordColor);
            document.documentElement.style.setProperty('--clp-kwd-color-dark', keywordColor);
            document.documentElement.style.setProperty('--clp-kwd-color-hc', keywordColor);
        }
    }
    if (valueColor) {
        if (autoAdjust) {
            // Apply theme-aware value color
            document.documentElement.style.setProperty('--clp-value-color', valueColor);
            document.documentElement.style.setProperty('--clp-value-color-light', adjustColorForTheme(valueColor, 'light'));
            document.documentElement.style.setProperty('--clp-value-color-dark', adjustColorForTheme(valueColor, 'dark'));
            document.documentElement.style.setProperty('--clp-value-color-hc', adjustColorForTheme(valueColor, 'high-contrast'));
        }
        else {
            // Use exact color for all themes
            document.documentElement.style.setProperty('--clp-value-color', valueColor);
            document.documentElement.style.setProperty('--clp-value-color-light', valueColor);
            document.documentElement.style.setProperty('--clp-value-color-dark', valueColor);
            document.documentElement.style.setProperty('--clp-value-color-hc', valueColor);
        }
    }
}
// Adjust color brightness for different themes
function adjustColorForTheme(color, theme) {
    // Parse color to RGB
    const rgb = parseColor(color);
    if (!rgb)
        return color;
    const { r, g, b } = rgb;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    // For light themes, darken bright colors; for dark themes, lighten dark colors
    if (theme === 'light') {
        if (brightness > 180) {
            // Color is too bright for light background, darken it
            return `rgb(${Math.floor(r * 0.5)}, ${Math.floor(g * 0.5)}, ${Math.floor(b * 0.5)})`;
        }
    }
    else if (theme === 'dark') {
        if (brightness < 100) {
            // Color is too dark for dark background, lighten it
            return `rgb(${Math.min(255, Math.floor(r * 1.8))}, ${Math.min(255, Math.floor(g * 1.8))}, ${Math.min(255, Math.floor(b * 1.8))})`;
        }
    }
    else if (theme === 'high-contrast') {
        // For high contrast, ensure maximum visibility
        if (brightness < 128) {
            return `rgb(${Math.min(255, Math.floor(r * 2))}, ${Math.min(255, Math.floor(g * 2))}, ${Math.min(255, Math.floor(b * 2))})`;
        }
    }
    return color; // Use original color if no adjustment needed
}
// Parse CSS color to RGB
function parseColor(color) {
    // Handle hex colors
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16)
            };
        }
        else if (hex.length === 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        }
    }
    // Handle rgb() colors
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1]),
            g: parseInt(rgbMatch[2]),
            b: parseInt(rgbMatch[3])
        };
    }
    // Handle named colors (basic set)
    const namedColors = {
        'yellow': '#FFFF00',
        'blue': '#0000FF',
        'red': '#FF0000',
        'green': '#008000',
        'white': '#FFFFFF',
        'black': '#000000',
        'orange': '#FFA500',
        'purple': '#800080'
    };
    if (namedColors[color.toLowerCase()]) {
        return parseColor(namedColors[color.toLowerCase()]);
    }
    return null;
}
function createInputForType(type, name, dft, len, suggestions) {
    const effectiveLen = len ? parseInt(len, 10) : getDefaultLengthForType(type);
    const dftLen = (dft || '').length;
    const useLongInput = effectiveLen > 80 || dftLen > 80;
    console.log(`[createInputForType] name=${name}, effectiveLen=${effectiveLen}, dftLen=${dftLen}, useLongInput=${useLongInput}, suggestions:`, suggestions, 'dft:', dft);
    // If there are suggestions AND it's a long input, use dropdown + textarea
    if (suggestions.length > 0 && useLongInput) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'flex-start'; // Prevent stretching
        container.style.gap = '8px';
        const select = document.createElement('select');
        select.id = `${name}_select`;
        select.style.width = 'auto'; // Auto-size to content
        select.style.minWidth = '150px'; // Minimum readable size
        select.style.maxWidth = '400px'; // Don't get too wide
        // Add prompt option
        const promptOption = document.createElement('option');
        promptOption.value = '';
        promptOption.textContent = '-- Select a value --';
        select.appendChild(promptOption);
        // Add suggestion options
        suggestions.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            // Pre-select if it matches the default
            if (val === dft) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        // Textarea (always visible)
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.value = dft || '';
        textarea.rows = 3;
        textarea.classList.add('long-text-input');
        // Selection handler - replace textarea content when user selects a value
        select.addEventListener('change', () => {
            const selectedValue = select.value;
            if (selectedValue) {
                // Replace entire textarea content with selected value
                textarea.value = selectedValue;
                textarea.focus();
            }
        });
        container.appendChild(select);
        container.appendChild(textarea);
        return container;
    }
    // If there are suggestions (but not long input), create standard combo box
    if (suggestions.length > 0) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.gap = '5px';
        container.style.alignItems = 'center';
        const select = document.createElement('select');
        select.id = `${name}_select`;
        select.style.minWidth = '150px';
        // Add suggestion options
        suggestions.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            if (val === dft) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        // Add "Custom..." option
        const customOption = document.createElement('option');
        customOption.value = '__CUSTOM__';
        customOption.textContent = '(Custom...)';
        select.appendChild(customOption);
        // Create hidden text input for custom values
        const input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.classList.add(getLengthClass(effectiveLen));
        input.style.display = 'none';
        // Set initial value
        if (dft && !suggestions.includes(dft)) {
            // Custom value - show input
            select.value = '__CUSTOM__';
            input.value = dft;
            input.style.display = '';
        }
        else if (dft) {
            // Suggestion value - store in hidden input
            input.value = dft;
        }
        // Handle selection change
        select.addEventListener('change', (e) => {
            const selectedValue = e.target.value;
            if (selectedValue === '__CUSTOM__') {
                input.style.display = '';
                input.focus();
                input.value = '';
            }
            else {
                input.style.display = 'none';
                input.value = selectedValue;
            }
        });
        container.appendChild(select);
        container.appendChild(input);
        return container;
    }
    // No suggestions - regular input or textarea for long values
    if (useLongInput) {
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.value = dft || '';
        textarea.rows = 3;
        textarea.classList.add('long-text-input');
        return textarea;
    }
    else {
        const input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.value = dft || '';
        input.classList.add(getLengthClass(effectiveLen));
        return input;
    }
}
// Create parm input (dropdown, textfield, or textarea for long values)
function createParmInput(name, suggestions, isRestricted, dft, len) {
    console.log('[clPrompter] ', 'createParmInput start');
    if (isRestricted && suggestions.length > 0) {
        // Use standard select for restricted dropdowns
        const select = document.createElement('select');
        select.name = name;
        select.style.minWidth = '150px';
        suggestions.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            if (val === dft) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        console.log('[clPrompter] ', 'createParmInput end1');
        return select;
    }
    else {
        console.log('[clPrompter] ', 'createParmInput end2');
        return createInputForType('CHAR', name, dft, len || '', suggestions);
    }
}
function createQualInput(parentParm, qual, qualName, qualType, qualLen, qualDft, isFirstPart) {
    // Build allowed values: parent SngVal/SpcVal (first part only) + this Qual's SpcVal/SngVal/Values
    const xmlVals = [];
    if (isFirstPart) {
        parentParm.querySelectorAll(':scope > SngVal > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
        parentParm.querySelectorAll(':scope > SpcVal > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
    }
    if (qual) {
        qual.querySelectorAll('SpcVal > Value, SngVal > Value, Values > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
    }
    const fromMap = (state.allowedValsMap || {})[qualName] || [];
    const allowedVals = Array.from(new Set(fromMap.concat(xmlVals)));
    const restricted = isRestricted(qual);
    // Default: for first part, prefer parent Dft if it’s among parent SngVal
    let dft = qualDft || '';
    if (isFirstPart) {
        const parentDft = String(parentParm.getAttribute('Dft') || '');
        const parentSng = new Set();
        parentParm.querySelectorAll(':scope > SngVal > Value').forEach(v => {
            const pv = v.getAttribute('Val');
            if (pv)
                parentSng.add(pv.toUpperCase());
        });
        if (parentDft && parentSng.has(parentDft.toUpperCase())) {
            dft = parentDft;
        }
    }
    // Size: prefer Qual Len and InlPmtLen; expand later on populate if value grows
    const inl = Number.parseInt(String(qual?.getAttribute('InlPmtLen') || ''), 10) || undefined;
    const len = Number.parseInt(String(qual?.getAttribute('Len') || ''), 10) || undefined;
    const input = createParmInput(qualName, allowedVals, restricted, dft, qualLen);
    ensureMinInputWidth(input, { len, inlPmtLen: inl });
    return input;
}
// Create elem input (textfield)
function createElemInput(parentParm, elem, elemName, elemType, elemLen, elemDft, isFirstTopLevelElem) {
    // Build allowed values: this Elem’s SpcVal/SngVal/Values (+ parent SngVal/SpcVal for first top-level)
    const xmlVals = [];
    if (elem) {
        elem.querySelectorAll('SpcVal > Value, SngVal > Value, Values > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
    }
    if (isFirstTopLevelElem) {
        parentParm.querySelectorAll(':scope > SngVal > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
        parentParm.querySelectorAll(':scope > SpcVal > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
    }
    const fromMap = (state.allowedValsMap || {})[elemName] || [];
    const allowedVals = Array.from(new Set(fromMap.concat(xmlVals)));
    const restricted = isRestricted(elem);
    // Default: for first top-level elem, prefer parent Dft when it’s among parent SngVal
    let dft = elemDft || '';
    if (isFirstTopLevelElem) {
        const parentDft = String(parentParm.getAttribute('Dft') || '');
        const parentSng = new Set();
        parentParm.querySelectorAll(':scope > SngVal > Value').forEach(v => {
            const pv = v.getAttribute('Val');
            if (pv)
                parentSng.add(pv.toUpperCase());
        });
        if (parentDft && parentSng.has(parentDft.toUpperCase())) {
            dft = parentDft;
        }
    }
    const inl = Number.parseInt(String(elem?.getAttribute('InlPmtLen') || ''), 10) || undefined;
    const len = Number.parseInt(String(elem?.getAttribute('Len') || ''), 10) || undefined;
    const input = createParmInput(elemName, allowedVals, restricted, dft, elemLen);
    ensureMinInputWidth(input, { len, inlPmtLen: inl });
    return input;
}
// Render simple parm
function renderSimpleParm(parm, kwd, container, dft, required, instanceId) {
    const div = document.createElement('div');
    div.className = 'parm simple-parm';
    // Input
    const type = String(parm.getAttribute('Type') || 'CHAR');
    const lenAttr = String(parm.getAttribute('Len') || '');
    const inlPmtLen = String(parm.getAttribute('InlPmtLen') || '');
    // Use Len if available, otherwise fall back to InlPmtLen (for types like CMD, PNAME, etc.)
    const effectiveLenAttr = lenAttr || inlPmtLen;
    const inputName = kwd;
    const allowedVals = (state.allowedValsMap || {})[inputName] || [];
    const restricted = isRestricted(parm);
    const len = Number.parseInt(lenAttr, 10) || undefined;
    const inl = Number.parseInt(inlPmtLen, 10) || undefined;
    const input = createParmInput(inputName, allowedVals, restricted, dft, effectiveLenAttr);
    ensureMinInputWidth(input, { len, inlPmtLen: inl });
    // Wrap in form-group for 5250-style grid layout with prompt and keyword in label
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group simple-parm-group';
    const label = document.createElement('label');
    const promptText = String(parm.getAttribute('Prompt') || kwd);
    // Create prompt text span
    const promptSpan = document.createElement('span');
    promptSpan.textContent = promptText;
    // Create keyword span with styling
    const kwdSpan = document.createElement('span');
    kwdSpan.className = 'parm-kwd';
    kwdSpan.textContent = ` (${kwd})`;
    label.appendChild(promptSpan);
    label.appendChild(kwdSpan);
    label.appendChild(document.createTextNode(':'));
    label.htmlFor = inputName;
    formGroup.appendChild(label);
    formGroup.appendChild(input);
    div.appendChild(formGroup);
    container.appendChild(div);
}
// Render QUAL parm
function renderQualParm(parm, kwd, container, prompt, idx, max) {
    console.log('[clPrompter] ', 'renderQualParm start');
    const qualParts = parm.querySelectorAll(':scope > Qual');
    const numParts = qualParts.length || 2;
    for (let i = 0; i < numParts; i++) {
        const qual = qualParts[i];
        const qualDiv = document.createElement('div');
        qualDiv.className = 'form-group';
        // Label: First QUAL uses parent (PARM) prompt, subsequent QUALs use their own Prompt attribute
        const label = document.createElement('label');
        let qualPrompt;
        if (i === 0) {
            // First QUAL inherits prompt from parent PARM
            qualPrompt = prompt;
        }
        else {
            // Subsequent QUALs use their own Prompt attribute
            qualPrompt = String(qual?.getAttribute('Prompt') || `Qualifier ${i}`);
        }
        // Add keyword to first QUAL label
        const labelText = i === 0 ? `${qualPrompt} (${kwd}):` : `${qualPrompt}:`;
        label.textContent = labelText;
        const qualName = `${kwd}_QUAL${i}`;
        label.htmlFor = qualName;
        qualDiv.appendChild(label);
        const qualType = String(qual?.getAttribute('Type') || 'NAME');
        const qualLen = String(qual?.getAttribute('Len') || '');
        const qualDft = String(qual?.getAttribute('Dft') || '');
        const input = createQualInput(parm, qual, qualName, qualType, qualLen, qualDft, i === 0);
        qualDiv.appendChild(input);
        container.appendChild(qualDiv);
    }
    console.log('[clPrompter] ', 'renderQualParm end');
}
function populateSimpleParm(kwd, parm, value) {
    const input = document.querySelector(`[name="${kwd}"]`);
    if (input) {
        input.value = value;
        const len = Number.parseInt(String(parm.getAttribute('Len') || ''), 10) || undefined;
        const inl = Number.parseInt(String(parm.getAttribute('InlPmtLen') || ''), 10) || undefined;
        ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: value.length });
    }
}
// Render ELEM parm
function renderElemParm(parm, kwd, idx, container, prompt, dft, max) {
    console.log('[clPrompter] ', 'renderElemParm start');
    const isMultiInstance = max > 1; // Don't pre-fill defaults for multi-instance
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'elem-group';
    const legend = document.createElement('legend');
    const promptSpan = document.createElement('span');
    promptSpan.textContent = prompt;
    legend.appendChild(promptSpan);
    const kwdSpan = document.createElement('span');
    kwdSpan.className = 'parm-kwd';
    kwdSpan.textContent = ` (${kwd})`;
    // Color applied via CSS using .parm-kwd class with theme-aware variables
    legend.appendChild(kwdSpan);
    fieldset.appendChild(legend);
    const elemParts = parm.querySelectorAll(':scope > Elem');
    elemParts.forEach((elem, i) => {
        const elemType = String(elem.getAttribute('Type') || 'CHAR');
        if (elemType === 'QUAL') {
            // ELEM with Type="QUAL" - render QUAL children directly without nested fieldset
            const elemPrompt = String(elem.getAttribute('Prompt') || `Element ${i}`);
            const qualParts = elem.querySelectorAll(':scope > Qual');
            qualParts.forEach((qual, j) => {
                const qualDiv = document.createElement('div');
                qualDiv.className = 'form-group';
                // Label: First QUAL uses parent (ELEM) prompt, subsequent QUALs use their own Prompt attribute
                const label = document.createElement('label');
                let qPrompt;
                if (j === 0) {
                    // First QUAL inherits prompt from parent ELEM
                    qPrompt = elemPrompt;
                }
                else {
                    // Subsequent QUALs use their own Prompt attribute
                    qPrompt = String(qual.getAttribute('Prompt') || `Qualifier ${j}`);
                }
                label.textContent = `${qPrompt}:`;
                const inputName = max > 1 ? `${kwd}_INST${idx}_ELEM${i}_QUAL${j}` : `${kwd}_ELEM${i}_QUAL${j}`;
                label.htmlFor = inputName;
                qualDiv.appendChild(label);
                const qualType = String(qual.getAttribute('Type') || 'NAME');
                const qualLen = String(qual.getAttribute('Len') || '');
                const qualDft = String(qual.getAttribute('Dft') || '');
                const input = createQualInput(parm, qual, inputName, qualType, qualLen, qualDft, i === 0 && j === 0 // only first qual of first top-level elem inherits parent lists/dft
                );
                qualDiv.appendChild(input);
                fieldset.appendChild(qualDiv);
            });
        }
        else {
            // Regular ELEM (not QUAL type)
            const elemDiv = document.createElement('div');
            elemDiv.className = 'form-group';
            const subElems = elem.querySelectorAll(':scope > Elem');
            if (subElems.length > 0) {
                subElems.forEach((subElem, j) => {
                    const subDiv = document.createElement('div');
                    subDiv.className = 'form-group';
                    const label = document.createElement('label');
                    const subPrompt = String(subElem.getAttribute('Prompt') || `Element ${i}.${j}`);
                    label.textContent = `${subPrompt}:`;
                    const inputName = max > 1 ? `${kwd}_INST${idx}_ELEM${i}_SUB${j}` : `${kwd}_ELEM${i}_SUB${j}`;
                    label.htmlFor = inputName;
                    subDiv.appendChild(label);
                    const subType = String(subElem.getAttribute('Type') || 'CHAR');
                    const subLen = String(subElem.getAttribute('Len') || '');
                    const subDft = isMultiInstance ? '' : String(subElem.getAttribute('Dft') || '');
                    const input = createElemInput(parm, subElem, inputName, subType, subLen, subDft, false);
                    subDiv.appendChild(input);
                    elemDiv.appendChild(subDiv);
                });
            }
            else {
                const label = document.createElement('label');
                const ePrompt = String(elem.getAttribute('Prompt') || `Element ${i}`);
                label.textContent = `${ePrompt}:`;
                const inputName = max > 1 ? `${kwd}_INST${idx}_ELEM${i}` : `${kwd}_ELEM${i}`;
                label.htmlFor = inputName;
                elemDiv.appendChild(label);
                const elemLen = String(elem.getAttribute('Len') || '');
                const elemDft = isMultiInstance ? '' : String(elem.getAttribute('Dft') || '');
                const input = createElemInput(parm, elem, inputName, elemType, elemLen, elemDft, i === 0);
                elemDiv.appendChild(input);
            }
            fieldset.appendChild(elemDiv);
        }
    });
    container.appendChild(fieldset);
    console.log('[clPrompter] ', 'renderElemParm end');
}
// Render parm instance
function renderParmInstance(parm, kwd, idx, max, multiGroupDiv) {
    console.log('[clPrompter] ', 'renderParmInstance start');
    const instDiv = document.createElement('div');
    instDiv.className = 'parm-instance';
    instDiv.dataset.kwd = kwd;
    const type = parm.getAttribute('Type') || '';
    const prompt = parm.getAttribute('Prompt') || kwd;
    const isMultiInstance = max > 1;
    // For multi-instance parameters, still need proper default for restricted fields
    let dft = parm.getAttribute('Dft') || '';
    if (isMultiInstance && !dft && isRestricted(parm)) {
        // For multi-instance restricted fields with no explicit default, use first allowed value
        dft = getFirstAllowedValue(parm);
    }
    const required = parm.getAttribute('Min') === '1';
    const instanceId = `${kwd}_INST${idx}`;
    const hasElem = !!parm.querySelector(':scope > Elem');
    const hasQual = !!parm.querySelector(':scope > Qual');
    // Note: renderSimpleParm creates its own header with prompt, so no label needed here
    if (hasElem || type === 'ELEM') {
        renderElemParm(parm, kwd, idx, instDiv, prompt, dft, max);
    }
    else if (hasQual || type === 'QUAL') {
        renderQualParm(parm, kwd, instDiv, prompt, idx, max);
    }
    else {
        renderSimpleParm(parm, kwd, instDiv, dft, required, instanceId);
    }
    if (max > 1 && multiGroupDiv) {
        addMultiInstanceControls(instDiv, parm, kwd, idx, max, multiGroupDiv);
    }
    console.log('[clPrompter] ', 'renderParmInstance end');
    return instDiv;
}
// Add multi-instance controls
function addMultiInstanceControls(container, parm, kwd, idx, max, multiGroupDiv) {
    console.log('[clPrompter] ', 'addMultiInstanceControls start');
    const btnBar = document.createElement('div');
    btnBar.className = 'multi-inst-controls';
    if (idx === 0) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'add-parm-btn';
        addBtn.textContent = '+';
        addBtn.onclick = () => {
            const instances = multiGroupDiv.querySelectorAll('.parm-instance');
            if (instances.length < max) {
                const newIdx = instances.length;
                const newInst = renderParmInstance(parm, kwd, newIdx, max, multiGroupDiv);
                multiGroupDiv.appendChild(newInst);
            }
        };
        btnBar.appendChild(addBtn);
    }
    else {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-parm-btn';
        removeBtn.textContent = '-';
        removeBtn.onclick = () => container.remove();
        btnBar.appendChild(removeBtn);
    }
    container.appendChild(btnBar);
    console.log('[clPrompter] ', 'addMultiInstanceControls end');
}
// Main form renderer
function loadForm() {
    console.log('[clPrompter] ', 'loadForm start');
    if (!state.xmlDoc)
        return;
    const form = document.getElementById('clForm');
    if (!form)
        return;
    form.innerHTML = '';
    state.parms.forEach(parm => {
        const kwd = parm.getAttribute('Kwd');
        if (!kwd)
            return;
        const constant = parm.getAttribute('Constant');
        const type = parm.getAttribute('Type');
        const max = parseInt(parm.getAttribute('Max') || '1', 10);
        if (constant || type?.toLowerCase() === 'null')
            return;
        if (max > 1) {
            const multiGroupDiv = document.createElement('div');
            multiGroupDiv.className = 'parm-multi-group';
            multiGroupDiv.dataset.kwd = kwd;
            multiGroupDiv.dataset.max = max.toString();
            multiGroupDiv.appendChild(renderParmInstance(parm, kwd, 0, max, multiGroupDiv));
            form.appendChild(multiGroupDiv);
        }
        else {
            form.appendChild(renderParmInstance(parm, kwd, 0, 1, null));
        }
    });
    // Calculate and apply optimal label width after all parameters are rendered
    optimizeLabelWidth();
    console.log('[clPrompter] ', 'loadForm end');
}
// Calculate the longest label and set a CSS custom property for optimal grid sizing
function optimizeLabelWidth() {
    // Only select labels inside the #clForm (exclude the Label field and title)
    const labels = document.querySelectorAll('#clForm .form-group label, #clForm .qual-group .form-group label, #clForm .elem-group .form-group label');
    let maxLength = 0;
    labels.forEach(label => {
        const text = label.textContent || '';
        if (text.length > maxLength) {
            maxLength = text.length;
        }
    });
    // Add 2ch padding, but cap at 50ch (don't exceed current max)
    const optimalWidth = Math.min(maxLength + 2, 50);
    // Set CSS custom property on the document root
    document.documentElement.style.setProperty('--clp-label-width', `${optimalWidth}ch`);
    console.log(`[clPrompter] Optimized label width: ${optimalWidth}ch (max label: ${maxLength} chars)`);
}
function getParentSngVals(parm) {
    const set = new Set();
    const nodes = parm.querySelectorAll(':scope > SngVal > Value');
    nodes.forEach(n => {
        const v = n.getAttribute('Val');
        if (v)
            set.add(v.toUpperCase());
    });
    return set;
}
// Helper: Get SpcVals from an ELEM (these act as single values for ELEM children)
function getElemSpcVals(elem) {
    const set = new Set();
    const nodes = elem.querySelectorAll(':scope > SpcVal > Value');
    nodes.forEach(n => {
        const v = n.getAttribute('Val');
        if (v)
            set.add(v.toUpperCase());
    });
    return set;
}
/**
 * Check if a nested ELEM group (with sub-elements) is entirely at default values
 */
function isNestedElemAtDefault(parm, elemIndex, selector) {
    const elemParts = parm.querySelectorAll(':scope > Elem');
    if (elemIndex >= elemParts.length)
        return true;
    const elem = elemParts[elemIndex];
    const subElems = elem.querySelectorAll(':scope > Elem');
    if (subElems.length === 0)
        return true; // Not a nested ELEM
    // Check each sub-element against its default
    for (let j = 0; j < subElems.length; j++) {
        const subElem = subElems[j];
        const subDefault = String(subElem.getAttribute('Dft') || '');
        // For nested ELEMs, only use explicit Dft attribute, no implicit defaults
        const input = selector(j);
        const value = (input?.value || '').trim();
        console.log(`[DEBUG nested] SUB${j} value: "${value}", default: "${subDefault}"`);
        // If value exists and doesn't match default, this nested ELEM is not at default
        if (value && !matchesDefault(value, subDefault)) {
            console.log(`[DEBUG nested] SUB${j} NON-DEFAULT (value doesn't match)`);
            return false;
        }
        // If value is empty and default is not empty, also not at default
        if (!value && subDefault) {
            console.log(`[DEBUG nested] SUB${j} NON-DEFAULT (empty value but has default)`);
            return false;
        }
    }
    console.log(`[DEBUG nested] All subs at defaults`);
    return true;
}
// Helper: safely join qualifier parts (omit empties, no leading/trailing '/')
function joinQualParts(parts) {
    const clean = parts.map(p => (p ?? '').trim()).filter(p => p.length > 0);
    if (clean.length === 0)
        return '';
    if (clean.length === 1)
        return clean[0];
    return clean.join('/');
}
// Helper: Get default value for a QUAL at given index
function getQualDefault(parm, qualIndex) {
    const qualParts = parm.querySelectorAll(':scope > Qual');
    if (qualIndex < qualParts.length) {
        const qual = qualParts[qualIndex];
        const qualDft = String(qual.getAttribute('Dft') || '');
        if (qualDft)
            return qualDft;
        // If no explicit default but field is restricted, use first allowed value
        if (isRestricted(qual)) {
            return getFirstAllowedValue(qual);
        }
    }
    return '';
}
// Helper: Get default value for a parameter element
function getElemDefault(parm, elemIndex) {
    const elemParts = parm.querySelectorAll(':scope > Elem');
    if (elemIndex < elemParts.length) {
        const elem = elemParts[elemIndex];
        const elemDft = String(elem.getAttribute('Dft') || '');
        if (elemDft)
            return elemDft;
    }
    // If no default on the Elem, check if parent Parm has a composite default
    const parmDft = String(parm.getAttribute('Dft') || '');
    if (parmDft) {
        // Parse defaults like "SRCSEQ(1.00 1.00)" or "(1.00 1.00)"
        let trimmed = parmDft.trim();
        // Strip keyword prefix like "SRCSEQ("
        const keywordMatch = trimmed.match(/^[A-Z][A-Z0-9]*\(/i);
        if (keywordMatch) {
            trimmed = trimmed.substring(keywordMatch[0].length - 1);
        }
        // Strip outer parentheses
        if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
            trimmed = trimmed.slice(1, -1);
        }
        // Split on spaces to get individual elem defaults
        const parts = trimmed.split(/\s+/);
        if (elemIndex < parts.length) {
            return parts[elemIndex];
        }
    }
    // For ELEM children, NO implicit default from "first allowed value"
    // That rule only applies to simple multi-instance PARM (not ELEM groups)
    return '';
}
// Helper: Get the FORM default (what the UI pre-fills) for an ELEM
// This is used to detect if user left the field at its pre-filled value
function getElemFormDefault(parm, elemIndex) {
    // First check for explicit defaults
    const explicitDefault = getElemDefault(parm, elemIndex);
    if (explicitDefault)
        return explicitDefault;
    // For restricted fields without explicit default, form pre-fills with first allowed value
    const elemParts = parm.querySelectorAll(':scope > Elem');
    if (elemIndex < elemParts.length) {
        const elem = elemParts[elemIndex];
        if (isRestricted(elem)) {
            const firstAllowed = getFirstAllowedValue(elem);
            if (firstAllowed)
                return firstAllowed;
        }
    }
    return '';
}
// Helper: Get first allowed value from SpcVal/SngVal/Values for a restricted field
function getFirstAllowedValue(elem) {
    const vals = [];
    elem.querySelectorAll('SpcVal > Value, SngVal > Value, Values > Value').forEach(v => {
        const val = v.getAttribute('Val');
        if (val && val !== '*NULL')
            vals.push(val);
    });
    return vals.length > 0 ? vals[0] : '';
}
// Helper: Check if a value matches its default (case-insensitive)
function matchesDefault(value, defaultVal) {
    if (!defaultVal)
        return false;
    return value.trim().toUpperCase() === defaultVal.trim().toUpperCase();
}
// New: split a qualified value left→right (LIB/OBJ), trimming surrounding quotes/paren
function splitQualLeftToRight(val) {
    let s = (val ?? '').trim();
    if (!s)
        return [];
    // Strip surrounding parentheses
    if (s.startsWith('(') && s.endsWith(')'))
        s = s.slice(1, -1);
    // Strip matching surrounding quotes
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
        s = s.slice(1, -1);
    }
    return s.split('/').map(p => p.trim()).filter(p => p.length > 0);
}
// Populate form from values
function populateFormFromValues(values) {
    console.log('[clPrompter] populateFormFromValues start, values:', values);
    Object.entries(values).forEach(([kwd, val]) => {
        console.log(`[clPrompter] Populating ${kwd} with val:`, val);
        const parm = state.parms.find(p => p.getAttribute('Kwd') === kwd);
        if (!parm) {
            console.log(`[clPrompter] Parm not found for ${kwd}`);
            return;
        }
        const max = parseInt(parm.getAttribute('Max') || '1', 10);
        const hasElem = !!parm.querySelector(':scope > Elem');
        const hasQual = !!parm.querySelector(':scope > Qual');
        if (max > 1) {
            const group = document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);
            if (!group)
                return;
            const splitValsArr = flattenParmValue(val);
            for (let i = 0; i < splitValsArr.length; i++) {
                ensureInstanceCount(group, parm, kwd, i + 1, max);
                const inst = group.querySelectorAll('.parm-instance')[i];
                if (!inst)
                    continue;
                if (hasElem) {
                    populateElemInputs(parm, state.parmMetas[kwd] || {}, kwd, splitValsArr[i], i, inst);
                }
                else if (hasQual) {
                    populateQualInputs(parm, state.parmMetas[kwd] || {}, kwd, splitValsArr[i], i, inst);
                }
                else {
                    const input = inst.querySelector(`[name="${kwd}"]`);
                    if (input)
                        input.value = splitValsArr[i];
                }
            }
        }
        else {
            if (hasElem) {
                populateElemInputs(parm, state.parmMetas[kwd] || {}, kwd, val, 0, document);
            }
            else if (hasQual) {
                populateQualInputs(parm, state.parmMetas[kwd] || {}, kwd, val, 0, document);
            }
            else {
                const input = document.querySelector(`[name="${kwd}"]`);
                console.log(`[clPrompter] Input for ${kwd}:`, input);
                if (input) {
                    console.log(`[clPrompter] Setting ${kwd} from "${input.value}" to "${val}"`);
                    input.value = val;
                    console.log(`[clPrompter] Set ${kwd} to "${input.value}"`);
                }
                else {
                    console.log(`[clPrompter] Input not found for ${kwd}`);
                }
            }
        }
    });
    console.log('[clPrompter] populateFormFromValues end');
}
// Helpers for population (simplified; expand as needed)
function populateElemInputs(parm, parmMeta, kwd, val, idx, container) {
    console.log('[clPrompter] populateElemInputs start for ${kwd}, val:', val);
    const parts = Array.isArray(val) ? val : parseSpaceSeparatedValues(val);
    console.log('[clPrompter] Parts:', parts);
    const elemParts = parm.querySelectorAll(':scope > Elem');
    parts.forEach((part, i) => {
        const elem = elemParts[i];
        if (!elem)
            return;
        const elemType = String(elem.getAttribute('Type') || 'CHAR');
        if (elemType === 'QUAL') {
            populateQualInputs(elem, parmMeta, `${kwd}_ELEM${i}`, part, idx, container);
        }
        else {
            const subElems = elem.querySelectorAll(':scope > Elem');
            if (subElems.length > 0) {
                const subParts = Array.isArray(part) ? part : [part];
                subParts.forEach((subPart, j) => {
                    let trimmedSubPart = subPart;
                    if (j === 0 && typeof trimmedSubPart === 'string' && trimmedSubPart.startsWith('(')) {
                        trimmedSubPart = trimmedSubPart.substring(1);
                    }
                    if (j === subParts.length - 1 && typeof trimmedSubPart === 'string' && trimmedSubPart.endsWith(')')) {
                        trimmedSubPart = trimmedSubPart.substring(0, trimmedSubPart.length - 1);
                    }
                    const input = container.querySelector(`[name="${kwd}_ELEM${i}_SUB${j}"]`);
                    console.log(`[clPrompter] Input ${kwd}_ELEM${i}_SUB${j}:`, input);
                    if (input) {
                        console.log(`[clPrompter] Setting ${kwd}_ELEM${i}_SUB${j} from "${input.value}" to "${trimmedSubPart}"`);
                        input.value = trimmedSubPart;
                        console.log(`[clPrompter] Set ${kwd}_ELEM${i}_SUB${j} to "${input.value}"`);
                        const sNode = subElems[j];
                        const len = Number.parseInt(String(sNode?.getAttribute('Len') || ''), 10) || undefined;
                        const inl = Number.parseInt(String(sNode?.getAttribute('InlPmtLen') || ''), 10) || undefined;
                        ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: String(trimmedSubPart ?? '').length });
                    }
                    else {
                        console.log(`[clPrompter] Input not found for ${kwd}_ELEM${i}_SUB${j}`);
                    }
                });
            }
            else {
                let trimmedPart = part;
                if (typeof trimmedPart === 'string') {
                    if (i === 0 && trimmedPart.startsWith('(')) {
                        trimmedPart = trimmedPart.substring(1);
                    }
                    if (i === parts.length - 1 && trimmedPart.endsWith(')')) {
                        trimmedPart = trimmedPart.substring(0, trimmedPart.length - 1);
                    }
                }
                const input = container.querySelector(`[name="${kwd}_ELEM${i}"]`);
                console.log(`[clPrompter] Input ${kwd}_ELEM${i}:`, input);
                if (input) {
                    console.log(`[clPrompter] Setting ${kwd}_ELEM${i} from "${input.value}" to "${trimmedPart}"`);
                    input.value = trimmedPart;
                    console.log(`[clPrompter] Set ${kwd}_ELEM${i} to "${input.value}"`);
                    const len = Number.parseInt(String(elem.getAttribute('Len') || ''), 10) || undefined;
                    const inl = Number.parseInt(String(elem.getAttribute('InlPmtLen') || ''), 10) || undefined;
                    ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: String(trimmedPart ?? '').length });
                }
                else {
                    console.log(`[clPrompter] Input not found for ${kwd}_ELEM${i}`);
                }
            }
        }
    });
    console.log('[clPrompter] populateElemInputs end');
}
function populateQualInputs(parm, parmMeta, kwd, val, idx, container) {
    console.log('[clPrompter] ', 'populateQualInputs start');
    const parts = Array.isArray(val) ? val : splitQualLeftToRight(String(val));
    const qualNodes = parm.querySelectorAll(':scope > Qual');
    // FIFO into inputs: QUAL0 ← parts[0], QUAL1 ← parts[1], ...
    let i = 0;
    for (;; i++) {
        const input = container.querySelector(`[name="${kwd}_QUAL${i}"]`);
        if (!input)
            break;
        const newVal = parts[i] ?? '';
        console.log(`[clPrompter] Input ${kwd}_QUAL${i}:`, input);
        // Check if this is a combo box (has a corresponding select)
        const select = container.querySelector(`#${kwd}_QUAL${i}_select`);
        if (select) {
            // This is a combo box - check if value is in suggestions
            const isInSuggestions = Array.from(select.options).some(opt => opt.value === newVal && opt.value !== '__CUSTOM__');
            if (isInSuggestions) {
                // Value is a suggestion - select it and hide custom input
                select.value = newVal;
                input.style.display = 'none';
                input.value = newVal;
            }
            else if (newVal) {
                // Custom value - select "Custom..." and show input
                select.value = '__CUSTOM__';
                input.style.display = '';
                input.value = newVal;
            }
            else {
                // Empty value - reset to first option
                select.selectedIndex = 0;
                input.style.display = 'none';
                input.value = select.value !== '__CUSTOM__' ? select.value : '';
            }
            console.log(`[clPrompter] Set combo ${kwd}_QUAL${i} to "${newVal}" (select="${select.value}", input="${input.value}", visible=${input.style.display !== 'none'})`);
        }
        else {
            // Regular input - set value directly
            if (input.value !== newVal) {
                console.log(`[clPrompter] Setting ${kwd}_QUAL${i} from "${input.value}" to "${newVal}"`);
                input.value = newVal;
                console.log(`[clPrompter] Set ${kwd}_QUAL${i} to "${input.value}"`);
            }
        }
        const qNode = qualNodes[i];
        const len = Number.parseInt(String(qNode?.getAttribute('Len') || ''), 10) || undefined;
        const inl = Number.parseInt(String(qNode?.getAttribute('InlPmtLen') || ''), 10) || undefined;
        ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: newVal.length });
    }
    console.log('[clPrompter] ', 'populateQualInputs end');
}
async function ensureInstanceCount(group, parm, kwd, targetCount, max) {
    console.log('[clPrompter] ', 'ensureInstanceCount start');
    while (group.querySelectorAll('.parm-instance').length < targetCount && group.querySelectorAll('.parm-instance').length < max) {
        const addBtn = group.querySelector('.add-parm-btn');
        if (addBtn)
            addBtn.click();
        else {
            const currentCount = group.querySelectorAll('.parm-instance').length;
            const newInst = renderParmInstance(parm, kwd, currentCount, max, group);
            group.appendChild(newInst);
        }
        await new Promise(r => setTimeout(r, 10));
    }
    console.log('[clPrompter] ', 'ensureInstanceCount end');
}
///////
// Assemble current values
//////////
function assembleCurrentParmMap() {
    const map = {};
    state.parms.forEach(parm => {
        const kwd = parm.getAttribute('Kwd');
        if (!kwd)
            return;
        const max = parseInt(parm.getAttribute('Max') || '1', 10);
        const hasElem = !!parm.querySelector(':scope > Elem');
        const hasQual = !!parm.querySelector(':scope > Qual');
        const parentSngVals = getParentSngVals(parm);
        if (max > 1) {
            const group = document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);
            const instances = group ? Array.from(group.querySelectorAll('.parm-instance')) : [];
            const arr = [];
            instances.forEach((inst, instIdx) => {
                if (hasElem) {
                    const elemParts = parm.querySelectorAll(':scope > Elem');
                    // Check parent SngVal or first ELEM SpcVal
                    const firstElemInput = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM0"]`);
                    const firstElemVal = (firstElemInput?.value || '').trim();
                    console.log(`[DEBUG] ${kwd} instance ELEM0 value: "${firstElemVal}"`);
                    // Skip instance if first ELEM is empty (user never filled it)
                    if (!firstElemVal) {
                        console.log(`[DEBUG] ${kwd} instance SKIPPED - empty ELEM0`);
                        return;
                    }
                    // For parent SngVal exclusivity check, use parent PARM's default
                    const parentParmDefault = String(parm.getAttribute('Dft') || '');
                    let isFirstElemSpecialAndDefault = false;
                    // Check if value matches parent SngVal (PARM-level, can replace entire parameter)
                    if (firstElemVal && parentSngVals.has(firstElemVal.toUpperCase())) {
                        console.log(`[DEBUG] ${kwd} ELEM0 matches parent SngVal: ${firstElemVal}`);
                        if (matchesDefault(firstElemVal, parentParmDefault)) {
                            console.log(`[DEBUG] ${kwd} ELEM0 matches parent default: ${parentParmDefault}`);
                            // First ELEM matches SngVal AND default - check if other ELEMs have non-default values
                            isFirstElemSpecialAndDefault = true;
                        }
                        else {
                            console.log(`[DEBUG] ${kwd} ELEM0 does NOT match parent default: ${parentParmDefault}`);
                            // SngVal but not default - return just this value
                            arr.push(firstElemVal);
                            return;
                        }
                    }
                    // If first ELEM matches special value AND default, check if ANY other ELEM has non-default value
                    if (isFirstElemSpecialAndDefault) {
                        console.log(`[DEBUG] ${kwd} checking other ELEMs for non-default values...`);
                        let hasOtherNonDefault = false;
                        for (let i = 1; i < elemParts.length; i++) {
                            const elem = elemParts[i];
                            const elemType = elem.getAttribute('Type') || 'CHAR';
                            const elemDefault = getElemFormDefault(parm, i); // Use form default
                            console.log(`[DEBUG] ${kwd} ELEM${i} form default: "${elemDefault}"`);
                            if (elemType === 'QUAL') {
                                const parts = [];
                                for (let j = 0;; j++) {
                                    const q = inst.querySelector(`[name="${kwd}_ELEM${i}_QUAL${j}"]`);
                                    if (!q)
                                        break;
                                    parts.push((q.value || '').trim());
                                }
                                const joined = joinQualParts([...parts].reverse());
                                if (joined && !matchesDefault(joined, elemDefault)) {
                                    hasOtherNonDefault = true;
                                    break;
                                }
                            }
                            else {
                                const subElems = elem.querySelectorAll(':scope > Elem');
                                if (subElems.length > 0) {
                                    // Nested ELEM group - check if all sub-elements are at defaults
                                    const isAtDefault = isNestedElemAtDefault(parm, i, (j) => inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}_SUB${j}"]`));
                                    if (!isAtDefault) {
                                        hasOtherNonDefault = true;
                                        break;
                                    }
                                }
                                else {
                                    const input = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}"]`);
                                    const v = (input?.value || '').trim();
                                    console.log(`[DEBUG] ${kwd} ELEM${i} value: "${v}"`);
                                    if (v && !matchesDefault(v, elemDefault)) {
                                        console.log(`[DEBUG] ${kwd} ELEM${i} is NON-DEFAULT`);
                                        hasOtherNonDefault = true;
                                        break;
                                    }
                                }
                            }
                        }
                        // If no other ELEM has non-default value, omit entire parameter
                        if (!hasOtherNonDefault) {
                            console.log(`[DEBUG] ${kwd} instance SKIPPED - all ELEMs at defaults`);
                            return;
                        }
                        console.log(`[DEBUG] ${kwd} instance INCLUDED - has non-default ELEM`);
                        // Otherwise fall through to assemble full ELEM group
                    }
                    // Even if first ELEM is not a special value, check if ALL ELEMs are at defaults
                    if (!isFirstElemSpecialAndDefault) {
                        console.log(`[DEBUG] ${kwd} checking if ALL ELEMs are at defaults...`);
                        let allAtDefaults = true;
                        for (let i = 0; i < elemParts.length; i++) {
                            const elem = elemParts[i];
                            const elemType = elem.getAttribute('Type') || 'CHAR';
                            const elemDefault = getElemFormDefault(parm, i); // Use form default for this check
                            if (elemType === 'QUAL') {
                                const parts = [];
                                for (let j = 0;; j++) {
                                    const q = inst.querySelector(`[name="${kwd}_ELEM${i}_QUAL${j}"]`);
                                    if (!q)
                                        break;
                                    parts.push((q.value || '').trim());
                                }
                                const joined = joinQualParts([...parts].reverse());
                                if (joined && !matchesDefault(joined, elemDefault)) {
                                    allAtDefaults = false;
                                    break;
                                }
                            }
                            else {
                                const subElems = elem.querySelectorAll(':scope > Elem');
                                if (subElems.length > 0) {
                                    const isAtDefault = isNestedElemAtDefault(parm, i, (j) => inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}_SUB${j}"]`));
                                    if (!isAtDefault) {
                                        allAtDefaults = false;
                                        break;
                                    }
                                }
                                else {
                                    const input = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}"]`);
                                    const v = (input?.value || '').trim();
                                    if (v && !matchesDefault(v, elemDefault)) {
                                        allAtDefaults = false;
                                        break;
                                    }
                                }
                            }
                        }
                        if (allAtDefaults) {
                            console.log(`[DEBUG] ${kwd} instance SKIPPED - all ELEMs at defaults`);
                            return;
                        }
                    }
                    // Assemble each top-level ELEM
                    const elemVals = [];
                    let lastNonDefaultIndex = -1;
                    console.log(`[DEBUG] ${kwd} assembling elemVals, elemParts.length=${elemParts.length}`);
                    elemParts.forEach((elem, i) => {
                        const elemType = elem.getAttribute('Type') || 'CHAR';
                        const elemDefault = getElemFormDefault(parm, i); // Use form default for output assembly
                        console.log(`[DEBUG] ${kwd} ELEM${i}: type=${elemType}, formDefault="${elemDefault}"`);
                        if (elemType === 'QUAL') {
                            // Collect QUAL parts (UI order), then LIFO back out and join safely
                            const parts = [];
                            for (let j = 0;; j++) {
                                const q = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}_QUAL${j}"]`);
                                if (!q)
                                    break;
                                parts.push((q.value || '').trim());
                            }
                            const joined = joinQualParts([...parts].reverse()); // omit empties, no stray '/'
                            if (joined) {
                                elemVals.push(joined);
                                if (!matchesDefault(joined, elemDefault)) {
                                    lastNonDefaultIndex = i;
                                }
                            }
                            else {
                                elemVals.push(''); // placeholder to maintain index alignment
                            }
                        }
                        else {
                            const subElems = elem.querySelectorAll(':scope > Elem');
                            if (subElems.length > 0) {
                                // Nested ELEM group - find last non-default sub and include values up to that point
                                const subVals = [];
                                let lastNonDefaultSub = -1;
                                subElems.forEach((subElem, j) => {
                                    const input = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}_SUB${j}"]`);
                                    const v = (input?.value || '').trim();
                                    subVals.push(v);
                                    const subDefault = String(subElem.getAttribute('Dft') || '');
                                    // For nested ELEMs, only use explicit Dft attribute, no implicit defaults
                                    if (v && !matchesDefault(v, subDefault)) {
                                        lastNonDefaultSub = j;
                                    }
                                });
                                // Only include sub-values up to last non-default, wrap in parens
                                if (lastNonDefaultSub >= 0) {
                                    const trimmedSubs = subVals.slice(0, lastNonDefaultSub + 1).filter(v => v.length > 0);
                                    const joined = '(' + trimmedSubs.join(' ') + ')';
                                    elemVals.push(joined);
                                    lastNonDefaultIndex = i;
                                }
                                else {
                                    elemVals.push(''); // All subs at default
                                }
                            }
                            else {
                                const input = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}"]`);
                                const v = (input?.value || '').trim();
                                console.log(`[DEBUG] ${kwd} ELEM${i}: input value="${v}", default="${elemDefault}"`);
                                if (v) {
                                    elemVals.push(v);
                                    const matches = matchesDefault(v, elemDefault);
                                    console.log(`[DEBUG] ${kwd} ELEM${i}: matchesDefault=${matches}`);
                                    if (!matches) {
                                        lastNonDefaultIndex = i;
                                        console.log(`[DEBUG] ${kwd} ELEM${i}: updated lastNonDefaultIndex to ${i}`);
                                    }
                                }
                                else {
                                    elemVals.push(''); // placeholder to maintain index alignment
                                    console.log(`[DEBUG] ${kwd} ELEM${i}: empty, pushed placeholder`);
                                }
                            }
                        }
                    });
                    // Only include ELEMs up to the last non-default ELEM
                    console.log(`[DEBUG] ${kwd} lastNonDefaultIndex=${lastNonDefaultIndex}, elemVals:`, elemVals);
                    if (lastNonDefaultIndex >= 0) {
                        const trimmedVals = elemVals.slice(0, lastNonDefaultIndex + 1).filter(v => v.length > 0);
                        const joined = trimmedVals.join(' ');
                        console.log(`[DEBUG] ${kwd} trimmedVals:`, trimmedVals, `joined="${joined}"`);
                        if (joined) {
                            arr.push(joined);
                        }
                    }
                }
                else if (hasQual) {
                    // Collect QUAL inputs (UI order: QUAL0, QUAL1, QUAL2...)
                    const parts = [];
                    const qualParts = parm.querySelectorAll(':scope > Qual');
                    for (let i = 0; i < qualParts.length; i++) {
                        const input = inst.querySelector(`[name="${kwd}_QUAL${i}"]`);
                        if (!input)
                            break;
                        parts.push((input.value || '').trim());
                    }
                    // If the first QUAL input equals a parent SngVal → only return that single value
                    const firstVal = parts[0] || '';
                    if (firstVal && parentSngVals.has(firstVal.toUpperCase())) {
                        arr.push(firstVal);
                    }
                    else {
                        // IBM i Rule #3: Find last user-modified QUAL and include all QUALs up to that point
                        let lastModifiedIndex = -1;
                        for (let i = 0; i < parts.length; i++) {
                            const qualDft = getQualDefault(parm, i);
                            const userVal = parts[i];
                            // A QUAL is considered "modified" if user entered something different from default
                            if (userVal && !matchesDefault(userVal, qualDft)) {
                                lastModifiedIndex = i;
                            }
                        }
                        // If any QUAL was modified, output all QUALs up to and including the last modified one
                        if (lastModifiedIndex >= 0) {
                            const outputParts = [];
                            for (let i = 0; i <= lastModifiedIndex; i++) {
                                const userVal = parts[i];
                                const qualDft = getQualDefault(parm, i);
                                // Use user value if provided, otherwise use default
                                outputParts.push(userVal || qualDft);
                            }
                            // Reverse for output (QUAL2/QUAL1/QUAL0 format)
                            const partsOut = outputParts.reverse().filter(p => p.length > 0);
                            if (partsOut.length > 0)
                                arr.push(partsOut);
                        }
                        // If no QUAL was modified, don't output the parameter at all
                    }
                }
                else {
                    // Simple multi-instance parameter - check against default
                    const input = inst.querySelector(`[name="${kwd}"]`);
                    const v = (input?.value || '').trim();
                    let parmDefault = String(parm.getAttribute('Dft') || '');
                    console.log(`[DEBUG] ${kwd} Dft attribute: "${parmDefault}"`);
                    console.log(`[DEBUG] ${kwd} isRestricted: ${isRestricted(parm)}`);
                    // For restricted fields, the form pre-fills with first allowed value, so check against that
                    if (isRestricted(parm)) {
                        const vals = [];
                        parm.querySelectorAll('SpcVal > Value, SngVal > Value, Values > Value').forEach(val => {
                            const v = val.getAttribute('Val');
                            if (v && v !== '*NULL')
                                vals.push(v);
                        });
                        console.log(`[DEBUG] ${kwd} allowed values: ${JSON.stringify(vals)}`);
                        if (vals.length > 0)
                            parmDefault = vals[0];
                    }
                    console.log(`[DEBUG] ${kwd} effective default: "${parmDefault}"`);
                    console.log(`[DEBUG] ${kwd} current value: "${v}"`);
                    console.log(`[DEBUG] ${kwd} matchesDefault: ${matchesDefault(v, parmDefault)}`);
                    // Only include if value differs from default
                    if (v && !matchesDefault(v, parmDefault)) {
                        console.log(`[DEBUG] ${kwd} INCLUDED - differs from default`);
                        arr.push(v);
                    }
                    else {
                        console.log(`[DEBUG] ${kwd} SKIPPED - matches default`);
                    }
                }
            });
            // Only include multi-instance parameter if there are non-default values
            if (arr.length > 0) {
                map[kwd] = arr;
            }
        }
        else {
            if (hasElem) {
                const elemParts = parm.querySelectorAll(':scope > Elem');
                // Check parent SngVal or first ELEM SpcVal
                const firstElemInput = document.querySelector(`[name="${kwd}_ELEM0"]`);
                const firstElemVal = (firstElemInput?.value || '').trim();
                // For parent SngVal exclusivity check, use parent PARM's default
                const parentParmDefault = String(parm.getAttribute('Dft') || '');
                let isFirstElemSpecialAndDefault = false;
                // Check if value matches parent SngVal
                if (firstElemVal && parentSngVals.has(firstElemVal.toUpperCase())) {
                    if (matchesDefault(firstElemVal, parentParmDefault)) {
                        // First ELEM matches SngVal AND default - check if other ELEMs have non-default values
                        isFirstElemSpecialAndDefault = true;
                    }
                    else {
                        // SngVal but not default - return just this value
                        map[kwd] = firstElemVal;
                        return;
                    }
                }
                else if (elemParts.length > 0) {
                    // Check if value matches first ELEM's SpcVal (acts as single value)
                    const firstElem = elemParts[0];
                    const firstElemSpcVals = getElemSpcVals(firstElem);
                    if (firstElemVal && firstElemSpcVals.has(firstElemVal.toUpperCase())) {
                        if (matchesDefault(firstElemVal, parentParmDefault)) {
                            // First ELEM matches SpcVal AND default - check if other ELEMs have non-default values
                            isFirstElemSpecialAndDefault = true;
                        }
                        else {
                            // SpcVal but not default - return just this value
                            map[kwd] = firstElemVal;
                            return;
                        }
                    }
                }
                // If first ELEM matches special value AND default, check if ANY other ELEM has non-default value
                if (isFirstElemSpecialAndDefault) {
                    let hasOtherNonDefault = false;
                    for (let i = 1; i < elemParts.length; i++) {
                        const elem = elemParts[i];
                        const elemType = elem.getAttribute('Type') || 'CHAR';
                        const elemDefault = getElemFormDefault(parm, i); // Use form default
                        if (elemType === 'QUAL') {
                            const parts = [];
                            for (let j = 0;; j++) {
                                const q = document.querySelector(`[name="${kwd}_ELEM${i}_QUAL${j}"]`);
                                if (!q)
                                    break;
                                parts.push((q.value || '').trim());
                            }
                            const joined = joinQualParts([...parts].reverse());
                            // Empty or matching default is considered at-default
                            if (joined && !matchesDefault(joined, elemDefault)) {
                                hasOtherNonDefault = true;
                                break;
                            }
                        }
                        else {
                            const subElems = elem.querySelectorAll(':scope > Elem');
                            if (subElems.length > 0) {
                                // Nested ELEM group - check if all sub-elements are at defaults
                                const isAtDefault = isNestedElemAtDefault(parm, i, (j) => document.querySelector(`[name="${kwd}_ELEM${i}_SUB${j}"]`));
                                if (!isAtDefault) {
                                    hasOtherNonDefault = true;
                                    break;
                                }
                            }
                            else {
                                const input = document.querySelector(`[name="${kwd}_ELEM${i}"]`);
                                const v = (input?.value || '').trim();
                                // Check if value exists AND differs from default
                                // Empty value is considered at-default
                                if (v) {
                                    // If there's a value, check if it's different from default
                                    if (!matchesDefault(v, elemDefault)) {
                                        hasOtherNonDefault = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    // If no other ELEM has non-default value, omit entire parameter
                    if (!hasOtherNonDefault) {
                        return;
                    }
                    // Otherwise fall through to assemble full ELEM group
                }
                // Assemble single-instance ELEM parameter
                const elemVals = [];
                let lastNonDefaultIndex = -1;
                elemParts.forEach((elem, i) => {
                    const elemType = elem.getAttribute('Type') || 'CHAR';
                    const elemDefault = getElemFormDefault(parm, i); // Use form default for output assembly
                    if (elemType === 'QUAL') {
                        const parts = [];
                        for (let j = 0;; j++) {
                            const q = document.querySelector(`[name="${kwd}_ELEM${i}_QUAL${j}"]`);
                            if (!q)
                                break;
                            parts.push((q.value || '').trim());
                        }
                        const joined = joinQualParts([...parts].reverse());
                        if (joined) {
                            elemVals.push(joined);
                            if (!matchesDefault(joined, elemDefault)) {
                                lastNonDefaultIndex = i;
                            }
                        }
                        else {
                            elemVals.push(''); // placeholder to maintain index alignment
                        }
                    }
                    else {
                        const subElems = elem.querySelectorAll(':scope > Elem');
                        if (subElems.length > 0) {
                            // Nested ELEM group - find last non-default sub and include values up to that point
                            const subVals = [];
                            let lastNonDefaultSub = -1;
                            subElems.forEach((subElem, j) => {
                                const input = document.querySelector(`[name="${kwd}_ELEM${i}_SUB${j}"]`);
                                const v = (input?.value || '').trim();
                                subVals.push(v);
                                const subDefault = String(subElem.getAttribute('Dft') || '');
                                // For nested ELEMs, only use explicit Dft attribute, no implicit defaults
                                if (v && !matchesDefault(v, subDefault)) {
                                    lastNonDefaultSub = j;
                                }
                            });
                            // Only include sub-values up to last non-default, wrap in parens
                            if (lastNonDefaultSub >= 0) {
                                const trimmedSubs = subVals.slice(0, lastNonDefaultSub + 1).filter(v => v.length > 0);
                                const joined = '(' + trimmedSubs.join(' ') + ')';
                                elemVals.push(joined);
                                lastNonDefaultIndex = i;
                            }
                            else {
                                elemVals.push(''); // All subs at default
                            }
                        }
                        else {
                            const input = document.querySelector(`[name="${kwd}_ELEM${i}"]`);
                            const v = (input?.value || '').trim();
                            if (v) {
                                elemVals.push(v);
                                if (!matchesDefault(v, elemDefault)) {
                                    lastNonDefaultIndex = i;
                                }
                            }
                            else {
                                elemVals.push(''); // placeholder to maintain index alignment
                            }
                        }
                    }
                });
                // Only include ELEMs up to the last non-default ELEM
                if (lastNonDefaultIndex >= 0) {
                    const trimmedVals = elemVals.slice(0, lastNonDefaultIndex + 1).filter(v => v.length > 0);
                    const joined = trimmedVals.join(' ');
                    if (joined) {
                        map[kwd] = `(${joined})`;
                    }
                }
            }
            else if (hasQual) {
                // Collect QUAL inputs (UI order)
                const parts = [];
                for (let i = 0;; i++) {
                    const input = document.querySelector(`[name="${kwd}_QUAL${i}"]`);
                    if (!input)
                        break;
                    parts.push((input.value || '').trim());
                }
                const firstVal = parts[0] || '';
                if (firstVal && parentSngVals.has(firstVal.toUpperCase())) {
                    map[kwd] = firstVal; // only the single value
                }
                else {
                    // IBM i Rule #3: Find last user-modified QUAL and include all QUALs up to that point
                    let lastModifiedIndex = -1;
                    for (let i = 0; i < parts.length; i++) {
                        const qualDft = getQualDefault(parm, i);
                        const userVal = parts[i];
                        // A QUAL is considered "modified" if user entered something different from default
                        if (userVal && !matchesDefault(userVal, qualDft)) {
                            lastModifiedIndex = i;
                        }
                    }
                    console.log(`[DEBUG] ${kwd} QUAL lastModifiedIndex:`, lastModifiedIndex);
                    // If any QUAL was modified, output all QUALs up to and including the last modified one
                    if (lastModifiedIndex >= 0) {
                        // Skip if first (required) QUAL is empty (Min=1)
                        const qualParts = parm.querySelectorAll(':scope > Qual');
                        const firstQualMin = parseInt(qualParts[0]?.getAttribute('Min') || '0', 10);
                        if (firstQualMin > 0 && (!parts[0] || parts[0].trim() === '')) {
                            console.log(`[DEBUG] ${kwd} SKIPPED - empty required first QUAL`);
                            return; // Don't output parameter if required first QUAL is empty
                        }
                        const outputParts = [];
                        for (let i = 0; i <= lastModifiedIndex; i++) {
                            const userVal = parts[i];
                            const qualDft = getQualDefault(parm, i);
                            // Use user value if provided, otherwise use default
                            outputParts.push(userVal || qualDft);
                        }
                        // Reverse for output (QUAL2/QUAL1/QUAL0 format)
                        const partsOut = outputParts.reverse().filter(p => p.length > 0);
                        if (partsOut.length > 0) {
                            map[kwd] = partsOut;
                        }
                    }
                    // If no QUAL was modified, don't output the parameter at all
                }
            }
            else {
                // Simple parameter - check against default
                const input = document.querySelector(`[name="${kwd}"]`);
                const value = (input?.value || '').trim();
                const parmDefault = String(parm.getAttribute('Dft') || '');
                // Only include if value is non-empty and differs from default
                if (value && !matchesDefault(value, parmDefault)) {
                    map[kwd] = value;
                }
            }
        }
    });
    return map;
}
//////////
// Event handlers
function onSubmit() {
    console.log('[clPrompter] ', 'onSubmit (Enter) start');
    const values = assembleCurrentParmMap();
    const cmdName = state.xmlDoc?.querySelector('Cmd')?.getAttribute('CmdName') || state.cmdName;
    vscode?.postMessage({ type: 'submit', cmdName, values });
    console.log('[clPrompter] ', 'onSubmit (Enter) end');
}
function onCancel() {
    console.log('[clPrompter] ', 'onCancel (F3=Cancel) start');
    const cmdName = state.xmlDoc?.querySelector('Cmd')?.getAttribute('CmdName') || state.cmdName;
    vscode?.postMessage({ type: 'cancel', cmdName });
    console.log('[clPrompter] ', 'onCancel (F3=Cancel) end');
}
function wirePrompterControls() {
    console.log('[clPrompter] ', 'wirePrompterControls start');
    if (state.controlsWired)
        return;
    console.log('[clPrompter] ', 'wirePrompterControls continuing...');
    const form = document.getElementById('clForm');
    const submitBtn = document.getElementById('submitBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', onSubmit);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', onCancel);
    }
    if (form) {
        form.addEventListener('submit', e => {
            e.preventDefault();
            onSubmit();
        });
    }
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
        }
        else if (e.key === 'Escape' || e.key === 'F3') {
            e.preventDefault();
            onCancel();
        }
    });
    state.controlsWired = true;
    console.log('[clPrompter] ', 'wirePrompterControls end');
}
function resetPrompterState() {
    console.log('[clPrompter] ', 'resetPrompterState start (never called?)');
    state.xmlDoc = null;
    state.parms = [];
    state.allowedValsMap = {};
    state.originalParmMap = {};
    state.cmdName = '';
    state.hasProcessedFormData = false;
    state.controlsWired = false;
    const form = document.getElementById('clForm');
    if (form)
        form.innerHTML = '';
    console.log('[clPrompter] ', 'resetPrompterState end');
}
// Message handler
window.addEventListener('message', event => {
    console.log('[clPrompter] ', 'addEventListener(\'message\') start');
    console.log('[clPrompter] Received message:', event.data); // Add this
    const message = event.data;
    if (message.type === 'formData') {
        console.log('[clPrompter] Processing formData'); // Add this
        if (state.hasProcessedFormData)
            return;
        state.hasProcessedFormData = true;
        const parser = new DOMParser();
        state.xmlDoc = parser.parseFromString(message.xml, 'text/xml');
        state.parms = Array.from(state.xmlDoc.querySelectorAll('Parm'));
        console.log('[clPrompter] Parsed parms:', state.parms.length); // Add this
        state.allowedValsMap = message.allowedValsMap || {};
        state.cmdName = message.cmdName || '';
        // Update main title with command name and prompt
        const cmdPrompt = message.cmdPrompt || '';
        console.log('[clPrompter] cmdName:', state.cmdName, 'cmdPrompt:', cmdPrompt);
        const mainTitle = document.getElementById('mainTitle');
        if (mainTitle && state.cmdName) {
            mainTitle.textContent = cmdPrompt ? `${state.cmdName} (${cmdPrompt})` : state.cmdName;
            console.log('[clPrompter] Set mainTitle to:', mainTitle.textContent);
        }
        state.originalParmMap = message.paramMap || message.parmMap || {};
        state.parmMetas = message.parmMetas || {};
        // Apply configured colors (if provided)
        const config = message.config;
        applyConfigStyles(config);
        loadForm();
        wirePrompterControls();
        if (Object.keys(state.originalParmMap).length > 0) {
            requestAnimationFrame(() => populateFormFromValues(state.originalParmMap));
        }
    }
    console.log('[clPrompter] ', 'addEventListener(\'message\') end');
});
// Handshake
(function postHandshake() {
    ['ready', 'loaded', 'webviewReady', 'requestFormData'].forEach(type => {
        vscode?.postMessage({ type });
    });
})();
// ...add once near top-level (after helpers), guarded to avoid duplicates...
(function injectKwdCss() {
    if (document.getElementById('clp-kwd-css'))
        return;
    const style = document.createElement('style');
    style.id = 'clp-kwd-css';
    style.textContent = `
    .parm-header { display: flex; gap: .5rem; align-items: baseline; }
    .parm-kwd { font-family: var(--vscode-font-family, monospace); opacity: 0.9; }
    .form-div > label { display: inline-block; min-width: 8ch; margin-right: .5rem; }
  `;
    document.head.appendChild(style);
})();
//# sourceMappingURL=prompter.js.map