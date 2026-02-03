import { createCBInput } from './webview-assets/cbinput.js';
import { getDefaultLengthForType, parseParenthesizedContent, getLengthClass } from './promptHelpers.js';
// 🔥 DIAGNOSTIC: Verify new prompter-v2.js is executing
console.log('🔥🔥🔥 PROMPTER-V2.JS IS EXECUTING! 🔥🔥🔥');
// Global state (typed)
let state = {
    xmlDoc: null,
    parms: [],
    allowedValsMap: {},
    originalParmMap: {},
    cmdName: '',
    cmdLabel: '',
    cmdComment: '',
    hasProcessedFormData: false,
    controlsWired: false,
    parmMetas: {},
    touchedFields: new Set(),
    isInitializing: false,
    elementsToTrack: [] // Elements to attach listeners to after initialization
};
const vscode = typeof window !== 'undefined' ? window.vscodeApi : undefined;
// Helper: Check if restricted
function isRestricted(el) {
    const rstd = el?.getAttribute('Rstd');
    return rstd === 'YES' || rstd === 'Y' || rstd === '*YES' || rstd === '1' || rstd === 'TRUE';
}
// Create a label with prompt text and keyword styling
// Returns a label element with properly styled prompt and keyword spans
function createPromptLabel(promptText, kwd, inputName) {
    const label = document.createElement('label');
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
    return label;
}
// Ensure inputs are wide enough to display content and XML sizing hints.
// Uses 'ch' units so width matches character counts.
// Automatically expands to fit CL variable names (e.g., &OUTPUTPTY).
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
    // Check for CL variables in the value (&VARIABLE_NAME)
    // Match &followed by any valid CL variable name characters
    const clVarMatch = current.match(/&[A-Z_][A-Z0-9_]*/gi);
    const clVarLen = clVarMatch ? Math.max(...clVarMatch.map(v => v.length)) : 0;
    // Use the longest of: parameter length, inline prompt length, current value length, or CL variable length
    // Add extra padding to prevent truncation of the last character
    const minCh = Math.max(4, len, inl, valueLen, clVarLen) + 1;
    // Only set 'size' for text-like inputs, NEVER for <select> (setting size > 1 turns it into a list box)
    if (tag === 'input' && (type === 'text' || type === 'search' || type === 'email' || type === 'url')) {
        if ('size' in anyEl && typeof anyEl.size === 'number') {
            anyEl.size = minCh;
        }
    }
    // Width hint for all controls (select, input, etc.)
    // Add more px padding to account for font and border/margin
    el.style.minWidth = `calc(${minCh}ch + 8px)`;
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
// Helper: Mark a field as touched by the user
function markFieldTouched(fieldName) {
    const ts = new Date().toISOString().substring(11, 23);
    if (state.isInitializing) {
        console.log(`[${ts}] [markFieldTouched] ${fieldName} IGNORED - form is initializing`);
        return;
    }
    state.touchedFields.add(fieldName);
    console.log(`[${ts}] [markFieldTouched] ${fieldName} MARKED as touched (total: ${state.touchedFields.size})`);
    // Apply dark green color to touched field
    const field = document.querySelector(`[name="${fieldName}"]`);
    if (field) {
        field.style.color = '#006400';
    }
}
// Helper: Check if a field was touched (user interacted with it)
function isFieldTouched(fieldName) {
    return state.touchedFields.has(fieldName);
}
// Helper: Check if a field was in the original command
function wasInOriginalCommand(fieldName) {
    if (!state.originalParmMap)
        return false;
    // First check exact match (for simple parameters)
    if (state.originalParmMap[fieldName] !== undefined) {
        return true;
    }
    // For QUAL/ELEM fields like JOB_QUAL0, JOB_ELEM0, JOB_INST0_ELEM0, etc.
    // Extract the base parameter name and check if that was in the original command
    const baseParam = fieldName.split('_')[0];
    return state.originalParmMap[baseParam] !== undefined;
}
// Helper: Normalize value against allowed values (case-insensitive match)
function normalizeValue(value, allowedValues, parm) {
    if (!value) {
        return value;
    }
    // NEVER modify quoted strings - they preserve case regardless of Case attribute
    // Check for surrounding quotes (apostrophes)
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
        return value;
    }
    // If no allowedValues passed but we have a parm/elem node, extract SpcVal from XML
    let valuesToCheck = allowedValues;
    if (valuesToCheck.length === 0 && parm) {
        const spcValNodes = parm.querySelectorAll(':scope > SpcVal > Value');
        if (spcValNodes.length > 0) {
            valuesToCheck = Array.from(spcValNodes).map(v => v.getAttribute('Val') || '');
        }
    }
    // Check if this parameter has Case=MONO (most parameters do)
    const caseAttr = parm?.getAttribute('Case');
    const isMono = !caseAttr || caseAttr.toUpperCase() === 'MONO';
    // Filter out range metadata before matching
    const displayValues = valuesToCheck.filter(v => !v.startsWith('_RANGE_'));
    // Try case-insensitive match against allowed values
    const valueUpper = value.toUpperCase();
    const match = displayValues.find(allowed => allowed.toUpperCase() === valueUpper);
    if (match) {
        // Found a match - return the canonical form
        return match;
    }
    // No match in allowed values - apply Case attribute
    if (isMono) {
        return value.toUpperCase();
    }
    return value;
}
// Helper: Parse range metadata from suggestions array
function parseRange(suggestions) {
    const rangePattern = /^_RANGE_(.+)_(.+)$/;
    for (const suggestion of suggestions) {
        const match = suggestion.match(rangePattern);
        if (match) {
            return { min: match[1], max: match[2] };
        }
    }
    return null;
}
// Helper: Configure range validation on an input element using native HTML attributes
function configureRangeValidation(input, suggestions, container) {
    const range = parseRange(suggestions);
    if (!range)
        return;
    // Get special values (non-range items from suggestions)
    const specialValues = suggestions.filter(s => !s.startsWith('_RANGE_'));
    // Try to determine if this is a numeric range
    const numMin = parseFloat(range.min);
    const numMax = parseFloat(range.max);
    const isNumericRange = !isNaN(numMin) && !isNaN(numMax);
    // Create error message span
    const errorSpan = document.createElement('span');
    errorSpan.className = 'range-error-message';
    errorSpan.style.color = '#ff0000';
    errorSpan.style.fontSize = '12px';
    errorSpan.style.marginLeft = '8px';
    errorSpan.style.display = 'none';
    errorSpan.style.fontWeight = 'bold';
    errorSpan.style.whiteSpace = 'nowrap';
    // Wrap the input (or container) and error span together so they share the same grid cell
    // This prevents the error span from being pushed outside the CSS grid layout
    const targetElement = container || input;
    const parent = targetElement.parentElement || targetElement.parentNode;
    if (parent) {
        // Create wrapper div to hold both input/container and error span
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';
        wrapper.style.flexWrap = 'wrap';
        wrapper.className = 'range-validation-wrapper';
        // Insert wrapper before the target element, then move target into wrapper
        parent.replaceChild(wrapper, targetElement);
        wrapper.appendChild(targetElement);
        wrapper.appendChild(errorSpan);
        console.log('[configureRangeValidation] Wrapper created and inserted');
        console.log('[configureRangeValidation] Wrapper parent:', wrapper.parentElement);
        console.log('[configureRangeValidation] Error span parent after append:', errorSpan.parentElement);
        console.log('[configureRangeValidation] Target element parent after append:', targetElement.parentElement);
    }
    else {
        // Fallback: append to body if no parent (shouldn't happen but be defensive)
        console.warn('[configureRangeValidation] No parent element found, cannot wrap input');
    }
    // Always use type="text" to allow CL variables (e.g., &NBR, &USER, &JOBNAME)
    // CL variables can be used in any parameter position
    input.type = 'text';
    // Add blur handler for range validation
    input.addEventListener('blur', () => {
        if (!input.value) {
            input.setCustomValidity('');
            input.style.color = '';
            errorSpan.style.display = 'none';
            errorSpan.textContent = '';
            return;
        }
        const valueUpper = input.value.toUpperCase();
        // Allow CL variables (start with &) - no validation needed
        if (input.value.startsWith('&')) {
            input.setCustomValidity('');
            input.style.color = '#006400'; // Valid - dark green
            errorSpan.style.display = 'none';
            errorSpan.textContent = '';
            return;
        }
        // Check if it's a special value (case-insensitive)
        if (specialValues.some(sv => sv.toUpperCase() === valueUpper)) {
            input.setCustomValidity('');
            input.style.color = '#006400'; // Valid - dark green
            errorSpan.style.display = 'none';
            errorSpan.textContent = '';
            return;
        }
        // Validate against range
        if (isNumericRange) {
            const numValue = parseFloat(input.value);
            if (!isNaN(numValue) && numValue >= numMin && numValue <= numMax) {
                input.setCustomValidity('');
                input.style.color = '#006400'; // Valid - dark green
                errorSpan.style.display = 'none';
                errorSpan.textContent = '';
                return;
            }
            else {
                // Out of range - show error
                const errorMsg = `Value must be between ${range.min} and ${range.max}`;
                console.log(`[Range Validation] Out of range! value=${input.value}, numValue=${numValue}, min=${numMin}, max=${numMax}`);
                console.log(`[Range Validation] Input element:`, input);
                console.log(`[Range Validation] Input parent:`, input.parentElement);
                console.log(`[Range Validation] Setting error span display to inline, textContent="${errorMsg}"`);
                console.log(`[Range Validation] Error span element:`, errorSpan);
                console.log(`[Range Validation] Error span parent:`, errorSpan.parentElement || errorSpan.parentNode);
                console.log(`[Range Validation] Looking for wrapper with class range-validation-wrapper...`);
                const wrapperCheck = input.closest('.range-validation-wrapper');
                console.log(`[Range Validation] Wrapper found:`, wrapperCheck);
                input.setCustomValidity(errorMsg);
                input.style.color = '#ff0000'; // Invalid - red
                errorSpan.textContent = errorMsg;
                errorSpan.style.display = 'inline';
                return;
            }
        }
        else {
            // Alphanumeric range
            if (input.value >= range.min && input.value <= range.max) {
                input.setCustomValidity('');
                input.style.color = '#006400'; // Valid - dark green
                errorSpan.style.display = 'none';
                errorSpan.textContent = '';
                return;
            }
        }
        // Invalid value - show error message
        const msg = `Value must be between ${range.min} and ${range.max}${specialValues.length > 0 ? ', or: ' + specialValues.join(', ') : ''}`;
        console.log(`[Range Validation] Invalid value (alphanumeric)! value="${input.value}", min="${range.min}", max="${range.max}"`);
        console.log(`[Range Validation] Setting error span display to inline, textContent="${msg}"`);
        console.log(`[Range Validation] Error span element:`, errorSpan);
        console.log(`[Range Validation] Error span parent:`, errorSpan.parentElement || errorSpan.parentNode);
        input.setCustomValidity(msg);
        input.style.color = '#ff0000'; // Invalid - red
        errorSpan.textContent = msg;
        errorSpan.style.display = 'inline';
    });
}
// Helper: Validate all inputs with range validation after form population
function validateAllRangeInputs() {
    const inputs = document.querySelectorAll('input[type="text"], textarea');
    inputs.forEach(input => {
        const el = input;
        const fieldName = el.name;
        if (!fieldName)
            return;
        // Check if this field has range validation by looking for _RANGE_ in allowed values
        const allowedVals = (state.allowedValsMap || {})[fieldName] || [];
        if (parseRange(allowedVals)) {
            // Trigger blur validation if field has a value
            if (el.value) {
                el.dispatchEvent(new Event('blur'));
            }
        }
    });
}
// Attach touch tracking to an input element
function attachTouchTracking(element) {
    const fieldName = element.name;
    if (!fieldName)
        return;
    const ts = new Date().toISOString().substring(11, 23);
    if (state.isInitializing) {
        // During initialization, just store the element for later
        console.log(`[${ts}] [attachTouchTracking] ${fieldName} STORED (queue: ${state.elementsToTrack.length + 1})`);
        state.elementsToTrack.push(element);
        return;
    }
    // After initialization, attach listeners immediately
    console.log(`[${ts}] [attachTouchTracking] ${fieldName} ATTACHED immediately`);
    const markTouched = () => markFieldTouched(fieldName);
    element.addEventListener('change', markTouched);
    element.addEventListener('input', markTouched);
}
// Attach listeners to all stored elements after initialization
function attachStoredListeners() {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] [attachStoredListeners] START - ${state.elementsToTrack.length} elements queued`);
    console.log(`[${ts}] [attachStoredListeners] isInitializing = ${state.isInitializing}`);
    console.log(`[${ts}] [attachStoredListeners] touchedFields.size = ${state.touchedFields.size}`);
    state.elementsToTrack.forEach(element => {
        const fieldName = element.name;
        if (fieldName) {
            console.log(`[${ts}] [attachStoredListeners] Attaching '${fieldName}'`);
            const markTouched = () => markFieldTouched(fieldName);
            element.addEventListener('change', markTouched);
            element.addEventListener('input', markTouched);
        }
    });
    state.elementsToTrack = [];
    console.log(`[${ts}] [attachStoredListeners] COMPLETE - listeners attached, queue cleared`);
}
// Apply dark green color to fields that have non-default values after initialization
// This runs AFTER form population. Fields that were in the original command get dark green.
// This mimics the IBM i prompter's ">" indicator for user-specified values.
function applyInitialFieldColors() {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] [applyInitialFieldColors] START`);
    const inputs = document.querySelectorAll('input[name], textarea[name]');
    let coloredCount = 0;
    inputs.forEach(input => {
        const fieldName = input.name;
        // Apply dark green if this field was in the original command
        // This mimics IBM i's ">" indicator for explicitly specified parameters
        if (wasInOriginalCommand(fieldName)) {
            input.style.color = '#006400';
            coloredCount++;
            console.log(`[${ts}] [applyInitialFieldColors] ${fieldName}: was in original command → dark green`);
        }
        else {
            console.log(`[${ts}] [applyInitialFieldColors] ${fieldName}: not in original command → default color`);
        }
    });
    console.log(`[${ts}] [applyInitialFieldColors] COMPLETE - ${coloredCount} fields colored dark green`);
}
function createInputForType(type, name, dft, len, suggestions, isRestricted = false) {
    const effectiveLen = len ? parseInt(len, 10) : getDefaultLengthForType(type);
    const dftLen = (dft || '').length;
    const typeUpper = type.toUpperCase();
    // LGL type should use textarea for CL expressions, but only when NOT restricted (Rstd=NO)
    const isLglType = !isRestricted && (typeUpper === 'LGL' || typeUpper === '*LGL');
    // CMD/CMDSTR types should always use textarea for command strings (can be up to 20000 chars)
    // CMD is IBM-reserved for inline commands (IF, ELSE, etc), CMDSTR is user-available equivalent
    const isCmdType = typeUpper === 'CMD' || typeUpper === 'CMDSTR';
    const useLongInput = isLglType || isCmdType || effectiveLen > 80 || dftLen > 80;
    console.log(`[createInputForType] name=${name}, type=${type}, effectiveLen=${effectiveLen}, dftLen=${dftLen}, isRestricted=${isRestricted}, isLglType=${isLglType}, isCmdType=${isCmdType}, useLongInput=${useLongInput}, suggestions:`, suggestions, 'dft:', dft);
    // If there are suggestions AND it's a long input, use cbInput dropdown + textarea
    // The cbInput provides quick selection with CL variable support, textarea allows manual editing
    if (suggestions.length > 0 && useLongInput) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'flex-start';
        container.style.gap = '8px';
        // Use cbInput instead of select to support CL variables
        const displaySuggestions = suggestions.filter(s => !s.startsWith('_RANGE_'));
        // Normalize the default value before populating the textarea
        const normalizedDft = dft ? normalizeValue(dft, displaySuggestions, null) : '';
        const cbinput = createCBInput({
            name: `${name}_select`,
            id: `${name}_select`,
            value: '',
            options: displaySuggestions,
            width: '200px',
            minWidth: '150px'
        });
        // Textarea (always visible for manual editing)
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.value = normalizedDft;
        textarea.dataset.default = normalizedDft;
        textarea.rows = 3;
        textarea.classList.add('long-text-input');
        attachTouchTracking(textarea);
        // Add range validation if applicable
        if (parseRange(suggestions)) {
            configureRangeValidation(textarea, suggestions);
        }
        // Add F4 handler for CMD/CMDSTR textareas
        console.log(`[createInputForType] Checking F4 for ${name}, isCmdType=${isCmdType}, type=${type}`);
        if (isCmdType) {
            console.log(`[createInputForType] ✓ F4 handler ENABLED for ${name}`);
            textarea.addEventListener('keydown', (e) => {
                console.log(`[F4] Key: ${e.key} on ${name}`);
                if (e.key === 'F4') {
                    console.log(`[F4] ✓ F4 detected on ${name}, value: "${textarea.value}"`);
                    e.preventDefault();
                    const commandString = textarea.value.trim();
                    if (commandString) {
                        console.log(`[F4] ✓ Sending promptNested for: ${commandString}`);
                        vscode?.postMessage({
                            type: 'promptNested',
                            fieldId: name,
                            commandString: commandString
                        });
                    }
                    else {
                        console.log(`[F4] ✗ Empty command string, ignoring`);
                    }
                }
            });
        }
        else {
            console.log(`[createInputForType] ✗ F4 handler NOT enabled for ${name}`);
        }
        // cbInput change handler - replace textarea content when user selects a value
        const cbInputElement = cbinput.getInputElement();
        cbInputElement.addEventListener('blur', () => {
            const selectedValue = cbInputElement.value;
            if (selectedValue) {
                // Normalize value against allowed values (case-insensitive match)
                const normalizedValue = normalizeValue(selectedValue, displaySuggestions, null);
                textarea.value = normalizedValue;
                cbInputElement.value = normalizedValue;
                textarea.focus();
                // Clear cbInput after transferring value
                cbInputElement.value = '';
            }
        });
        container.appendChild(cbinput.getElement());
        container.appendChild(textarea);
        return container;
    }
    // If there are suggestions (but not long input), check if they're only range metadata
    if (suggestions.length > 0) {
        // Filter out range metadata from display
        const displaySuggestions = suggestions.filter(s => !s.startsWith('_RANGE_'));
        // If only range metadata (no actual special values), use regular input with range validation
        if (displaySuggestions.length === 0) {
            const input = document.createElement('input');
            input.type = 'text';
            input.name = name;
            input.value = dft || '';
            input.dataset.default = dft || '';
            input.classList.add(getLengthClass(effectiveLen));
            attachTouchTracking(input);
            // Add range validation - defer until after DOM insertion
            if (parseRange(suggestions)) {
                setTimeout(() => {
                    configureRangeValidation(input, suggestions);
                }, 0);
            }
            return input;
        }
        // Has actual special values - use CBInput but with filtered suggestions
        // Normalize the default value before populating the input
        const normalizedDft = dft ? normalizeValue(dft, displaySuggestions, null) : '';
        const maxLength = Math.max(normalizedDft?.length || 0, ...displaySuggestions.map(s => s.length));
        const inputWidth = Math.max(15, maxLength + 3);
        const cbinput = createCBInput({
            name: name,
            id: name,
            value: normalizedDft,
            options: displaySuggestions, // Use filtered suggestions
            width: `${inputWidth}ch`,
            minWidth: '150px'
        });
        const inputElement = cbinput.getInputElement();
        attachTouchTracking(inputElement);
        // Add blur handler to normalize values against allowed values
        inputElement.addEventListener('blur', () => {
            if (inputElement.value) {
                const normalizedValue = normalizeValue(inputElement.value, displaySuggestions, null);
                inputElement.value = normalizedValue;
            }
        });
        // Add range validation if applicable - pass full suggestions array for validation
        // Defer until after DOM insertion
        if (parseRange(suggestions)) {
            const container = cbinput.getElement();
            setTimeout(() => {
                configureRangeValidation(inputElement, suggestions, container);
            }, 0);
        }
        return cbinput.getElement();
    }
    // No suggestions - regular input or textarea for long values
    if (useLongInput) {
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.value = dft || '';
        textarea.dataset.default = dft || '';
        textarea.rows = 3;
        textarea.classList.add('long-text-input');
        attachTouchTracking(textarea);
        // Add range validation if applicable - defer until after DOM insertion
        if (parseRange(suggestions)) {
            setTimeout(() => {
                configureRangeValidation(textarea, suggestions);
            }, 0);
        }
        // Add F4 handler for CMD/CMDSTR textareas
        console.log(`[createInputForType] Checking F4 for ${name}, isCmdType=${isCmdType}, type=${type}`);
        if (isCmdType) {
            console.log(`[createInputForType] ✓ F4 handler ENABLED for ${name}`);
            textarea.addEventListener('keydown', (e) => {
                console.log(`[F4] Key: ${e.key} on ${name}`);
                if (e.key === 'F4') {
                    console.log(`[F4] ✓ F4 detected on ${name}, value: "${textarea.value}"`);
                    e.preventDefault();
                    const commandString = textarea.value.trim();
                    if (commandString) {
                        console.log(`[F4] ✓ Sending promptNested for: ${commandString}`);
                        vscode?.postMessage({
                            type: 'promptNested',
                            fieldId: name,
                            commandString: commandString
                        });
                    }
                    else {
                        console.log(`[F4] ✗ Empty command string, ignoring`);
                    }
                }
            });
        }
        else {
            console.log(`[createInputForType] ✗ F4 handler NOT enabled for ${name}`);
        }
        return textarea;
    }
    else {
        const input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.value = dft || '';
        input.dataset.default = dft || '';
        input.classList.add(getLengthClass(effectiveLen));
        attachTouchTracking(input);
        // Add range validation if applicable - defer until after DOM insertion
        console.log(`[createInputForType] Checking range validation for ${name}, suggestions:`, suggestions);
        const rangeInfo = parseRange(suggestions);
        console.log(`[createInputForType] Range info for ${name}:`, rangeInfo);
        if (rangeInfo) {
            console.log(`[createInputForType] Scheduling deferred range validation for ${name}`);
            // Use setTimeout to defer validation setup until after the input is in the DOM
            setTimeout(() => {
                console.log(`[createInputForType] Executing deferred configureRangeValidation for ${name}`);
                configureRangeValidation(input, suggestions);
            }, 0);
        }
        else {
            console.log(`[createInputForType] NO range validation for ${name}`);
        }
        return input;
    }
}
// Create parm input (cbInput or textfield for all parameters to support CL variables)
function createParmInput(name, suggestions, isRestricted, dft, len, type) {
    console.log(`[createParmInput] ${name}: suggestions=`, suggestions, 'isRestricted=', isRestricted, 'type=', type);
    // Even restricted parameters must support CL variables, so always use cbInput when there are suggestions
    if (isRestricted && suggestions.length > 0) {
        // Normalize the default value before populating the input
        const normalizedDft = dft ? normalizeValue(dft, suggestions, null) : '';
        // Use cbInput instead of select to support CL variables like &VAR
        const maxLength = Math.max(normalizedDft?.length || 0, ...suggestions.map(s => s.length));
        const inputWidth = Math.max(15, maxLength + 3);
        const cbinput = createCBInput({
            name: name,
            id: name,
            value: normalizedDft,
            options: suggestions,
            width: `${inputWidth}ch`,
            minWidth: '150px'
        });
        const inputElement = cbinput.getInputElement();
        attachTouchTracking(inputElement);
        // Add blur handler to normalize values against allowed values
        inputElement.addEventListener('blur', () => {
            if (inputElement.value) {
                const normalizedValue = normalizeValue(inputElement.value, suggestions, null);
                inputElement.value = normalizedValue;
            }
        });
        console.log('[clPrompter] ', 'createParmInput end1');
        return cbinput.getElement();
    }
    else {
        console.log('[clPrompter] ', 'createParmInput end2');
        return createInputForType(type || 'CHAR', name, dft, len || '', suggestions, isRestricted);
    }
}
function createQualInput(parentParm, qual, qualName, qualType, qualLen, qualDft, isFirstPart) {
    // Build allowed values: this Qual's SpcVal/SngVal/Values, plus parent for first part
    const xmlVals = [];
    // For the FIRST QUAL only, include parent-level SngVal/SpcVal (e.g., JOB(*))
    if (isFirstPart) {
        parentParm.querySelectorAll(':scope > SpcVal > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
        parentParm.querySelectorAll(':scope > SngVal > Value').forEach(v => {
            const val = v.getAttribute('Val');
            if (val && val !== '*NULL')
                xmlVals.push(val);
        });
    }
    // Add this Qual's own special values
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
    console.log(`[createQualInput] ${qualName}: xmlVals=`, xmlVals, 'fromMap=', fromMap, 'allowedVals=', allowedVals, 'restricted=', restricted);
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
    const input = createParmInput(qualName, allowedVals, restricted, dft, qualLen, qualType);
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
    const input = createParmInput(elemName, allowedVals, restricted, dft, elemLen, elemType);
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
    const input = createParmInput(inputName, allowedVals, restricted, dft, effectiveLenAttr, type);
    ensureMinInputWidth(input, { len, inlPmtLen: inl });
    // Wrap in form-group for 5250-style grid layout with prompt and keyword in label
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group simple-parm-group';
    // For multi-instance, only show label for the first instance (instanceId ends with _INST0)
    let showLabel = true;
    if (instanceId && /_INST\d+$/.test(instanceId)) {
        const idx = Number(instanceId.replace(/.*_INST/, ''));
        if (idx > 0)
            showLabel = false;
    }
    if (showLabel) {
        const promptText = String(parm.getAttribute('Prompt') || kwd);
        const label = createPromptLabel(promptText, kwd, inputName);
        formGroup.appendChild(label);
    }
    else {
        // Insert an empty label to preserve grid alignment
        const emptyLabel = document.createElement('label');
        emptyLabel.textContent = '';
        formGroup.appendChild(emptyLabel);
    }
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
        let qualPrompt;
        if (i === 0) {
            // First QUAL inherits prompt from parent PARM
            qualPrompt = prompt;
        }
        else {
            // Subsequent QUALs use their own Prompt attribute
            qualPrompt = String(qual?.getAttribute('Prompt') || `Qualifier ${i}`);
        }
        const qualName = `${kwd}_QUAL${i}`;
        // Create label: first QUAL gets keyword, others don't
        let label;
        if (i === 0) {
            // Check if prompt already contains keyword in parentheses and strip it if present
            const kwdPattern = /\s*\(([A-Z][A-Z0-9]*)\)\s*$/i;
            const match = qualPrompt.match(kwdPattern);
            const promptTextOnly = match ? qualPrompt.substring(0, match.index).trim() : qualPrompt;
            // Use reusable function to create label with keyword styling
            label = createPromptLabel(promptTextOnly, kwd, qualName);
        }
        else {
            // Subsequent QUALs - simple label without keyword
            label = document.createElement('label');
            label.textContent = `${qualPrompt}:`;
            label.htmlFor = qualName;
        }
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
        // Get allowed values and normalize
        const allowedVals = (state.allowedValsMap || {})[kwd] || [];
        const normalizedValue = normalizeValue(value, allowedVals, parm);
        input.value = normalizedValue;
        const len = Number.parseInt(String(parm.getAttribute('Len') || ''), 10) || undefined;
        const inl = Number.parseInt(String(parm.getAttribute('InlPmtLen') || ''), 10) || undefined;
        ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: normalizedValue.length });
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
                const inputName = `${kwd}_INST${idx}_ELEM${i}_QUAL${j}`;
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
                    const inputName = `${kwd}_INST${idx}_ELEM${i}_SUB${j}`;
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
                const inputName = `${kwd}_INST${idx}_ELEM${i}`;
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
        addBtn.title = 'Add entry';
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
        removeBtn.textContent = '—'; // em dash
        removeBtn.title = 'Remove entry';
        removeBtn.onclick = () => container.remove();
        btnBar.appendChild(removeBtn);
    }
    container.appendChild(btnBar);
    console.log('[clPrompter] ', 'addMultiInstanceControls end');
}
// Main form renderer
function loadForm() {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] [loadForm] START`);
    state.isInitializing = true;
    state.touchedFields.clear();
    state.elementsToTrack = [];
    console.log(`[${ts}] [loadForm] isInitializing = true, touchedFields cleared, queue cleared`);
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
    // Form initialization complete - now track user touches
    const ts2 = new Date().toISOString().substring(11, 23);
    console.log(`[${ts2}] [loadForm] Setting isInitializing = false`);
    state.isInitializing = false;
    console.log(`[${ts2}] [loadForm] About to call attachStoredListeners()`);
    attachStoredListeners();
    applyInitialFieldColors();
    console.log(`[${ts2}] [loadForm] END - Form ready for user interaction`);
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
    const elemParts = parm.querySelectorAll(':scope > Elem');
    if (elemIndex >= elemParts.length)
        return '';
    const elem = elemParts[elemIndex];
    // First check for explicit Dft attribute on the ELEM itself
    const explicitElemDft = String(elem.getAttribute('Dft') || '');
    if (explicitElemDft)
        return explicitElemDft;
    // Then check parent PARM for composite default (e.g., "SRCSEQ(1.00 1.00)")
    const compositeDefault = getElemDefault(parm, elemIndex);
    if (compositeDefault)
        return compositeDefault;
    // For restricted fields without explicit default, the first allowed value becomes the default
    // This is both what the form pre-fills AND what should be considered the "unchanged" state
    if (isRestricted(elem)) {
        const firstAllowed = getFirstAllowedValue(elem);
        if (firstAllowed)
            return firstAllowed;
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
    // DEPRECATED: This function should no longer be used for assembly logic.
    // Touch tracking has replaced default value comparison.
    const caller = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
    console.warn(`[DEPRECATED] matchesDefault() called from: ${caller}`);
    console.warn(`[DEPRECATED]   value="${value}", default="${defaultVal}"`);
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
    state.isInitializing = true;
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
        // All values are now string[][]
        // instances[instanceIdx][elemIdx or qualIdx]
        const instances = val;
        if (max > 1) {
            const group = document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);
            if (!group)
                return;
            for (let i = 0; i < instances.length; i++) {
                ensureInstanceCount(group, parm, kwd, i + 1, max);
                const inst = group.querySelectorAll('.parm-instance')[i];
                if (!inst)
                    continue;
                if (hasElem) {
                    populateElemInputs(parm, state.parmMetas[kwd] || {}, kwd, instances[i], i, inst);
                }
                else if (hasQual) {
                    populateQualInputs(parm, state.parmMetas[kwd] || {}, kwd, instances[i], i, inst);
                }
                else {
                    let input = inst.querySelector(`[name="${kwd}"]`);
                    if (input) {
                        // Check if we found a cbInput container - if so, get the actual input element
                        if (input.classList?.contains('cbinput-container')) {
                            const actualInput = input.querySelector('.cbinput-input');
                            if (actualInput) {
                                console.log(`[clPrompter] Found cbInput container, using actual input element`);
                                input = actualInput;
                            }
                        }
                        const rawVal = instances[i][0];
                        const allowedVals = (state.allowedValsMap || {})[kwd] || [];
                        const normalizedVal = normalizeValue(rawVal, allowedVals, parm);
                        input.value = normalizedVal; // Simple param has only one element
                    }
                }
            }
        }
        else {
            if (hasElem) {
                populateElemInputs(parm, state.parmMetas[kwd] || {}, kwd, instances[0], 0, document);
            }
            else if (hasQual) {
                populateQualInputs(parm, state.parmMetas[kwd] || {}, kwd, instances[0], 0, document);
            }
            else {
                let input = document.querySelector(`[name="${kwd}"]`);
                console.log(`[clPrompter] Input for ${kwd}:`, input);
                if (input) {
                    // Check if we found a cbInput container - if so, get the actual input element
                    if (input.classList?.contains('cbinput-container')) {
                        const actualInput = input.querySelector('.cbinput-input');
                        if (actualInput) {
                            console.log(`[clPrompter] Found cbInput container, using actual input element`);
                            input = actualInput;
                        }
                    }
                    const rawVal = instances[0][0]; // Simple param: first instance, first element
                    const allowedVals = (state.allowedValsMap || {})[kwd] || [];
                    const normalizedVal = normalizeValue(rawVal, allowedVals, parm);
                    console.log(`[clPrompter] Setting ${kwd} from "${input.value}" to "${normalizedVal}" (original: "${rawVal}")`);
                    input.value = normalizedVal;
                    console.log(`[clPrompter] Set ${kwd} to "${input.value}"`);
                }
                else {
                    console.log(`[clPrompter] Input not found for ${kwd}`);
                }
            }
        }
    });
    state.isInitializing = false;
    attachStoredListeners();
    applyInitialFieldColors();
    // Validate all range inputs after population
    requestAnimationFrame(() => validateAllRangeInputs());
    console.log('[clPrompter] populateFormFromValues end');
}
// Helpers for population (simplified; expand as needed)
function populateElemInputs(parm, parmMeta, kwd, instance, idx, container) {
    console.log(`[clPrompter] populateElemInputs for ${kwd}, instance:`, instance);
    console.log(`[clPrompter] Instance array length: ${instance.length}`);
    const elemParts = parm.querySelectorAll(':scope > Elem');
    console.log(`[clPrompter] Number of ELEM parts in XML: ${elemParts.length}`);
    instance.forEach((elemValue, i) => {
        console.log(`[clPrompter] Processing ELEM ${i}: value="${elemValue}"`);
        const elem = elemParts[i];
        if (!elem) {
            console.log(`[clPrompter] ❌ No ELEM definition found for index ${i}`);
            return;
        }
        const elemType = String(elem.getAttribute('Type') || 'CHAR');
        if (elemType === 'QUAL') {
            // elemValue for QUAL should be already split by parser
            // For now, we need to parse it here since we're passing as string
            const qualParts = splitQualLeftToRight(elemValue);
            populateQualInputs(elem, parmMeta, `${kwd}_ELEM${i}`, qualParts, idx, container);
        }
        else {
            const subElems = elem.querySelectorAll(':scope > Elem');
            if (subElems.length > 0) {
                // Nested ELEM group - parse parenthesized content
                const subParts = parseParenthesizedContent(elemValue);
                console.log(`[clPrompter] Nested ELEM ${kwd}_INST${idx}_ELEM${i} subParts:`, subParts);
                subParts.forEach((subPart, j) => {
                    let input = container.querySelector(`[name="${kwd}_INST${idx}_ELEM${i}_SUB${j}"]`);
                    console.log(`[clPrompter] Input ${kwd}_INST${idx}_ELEM${i}_SUB${j}:`, input);
                    if (input) {
                        // Check if we found a cbInput container - if so, get the actual input element
                        if (input.classList?.contains('cbinput-container')) {
                            const actualInput = input.querySelector('.cbinput-input');
                            if (actualInput) {
                                console.log(`[clPrompter] Found cbInput container, using actual input element`);
                                input = actualInput;
                            }
                        }
                        const sNode = subElems[j];
                        const allowedVals = sNode ? ((state.allowedValsMap || {})[`${kwd}_INST${idx}_ELEM${i}_SUB${j}`] || []) : [];
                        const normalizedVal = normalizeValue(subPart, allowedVals, sNode);
                        console.log(`[clPrompter] Setting ${kwd}_INST${idx}_ELEM${i}_SUB${j} from "${input.value}" to "${normalizedVal}" (original: "${subPart}")`);
                        input.value = normalizedVal;
                        console.log(`[clPrompter] Set ${kwd}_INST${idx}_ELEM${i}_SUB${j} to "${input.value}"`);
                        const len = Number.parseInt(String(sNode?.getAttribute('Len') || ''), 10) || undefined;
                        const inl = Number.parseInt(String(sNode?.getAttribute('InlPmtLen') || ''), 10) || undefined;
                        ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: String(subPart ?? '').length });
                    }
                    else {
                        console.log(`[clPrompter] Input not found for ${kwd}_INST${idx}_ELEM${i}_SUB${j}`);
                    }
                });
            }
            else {
                let input = container.querySelector(`[name="${kwd}_INST${idx}_ELEM${i}"]`);
                console.log(`[clPrompter] Input ${kwd}_INST${idx}_ELEM${i}:`, input);
                if (input) {
                    // Check if we found a cbInput container - if so, get the actual input element
                    if (input.classList?.contains('cbinput-container')) {
                        const actualInput = input.querySelector('.cbinput-input');
                        if (actualInput) {
                            console.log(`[clPrompter] Found cbInput container, using actual input element`);
                            input = actualInput;
                        }
                    }
                    // Get allowed values from the Elem node (for special values like *SECLVL)
                    // and from state.allowedValsMap as fallback
                    const allowedFromMap = (state.allowedValsMap || {})[kwd] || [];
                    const normalizedVal = normalizeValue(elemValue, allowedFromMap, elem);
                    console.log(`[clPrompter] Setting ${kwd}_INST${idx}_ELEM${i} from "${input.value}" to "${normalizedVal}" (original: "${elemValue}")`);
                    input.value = normalizedVal;
                    console.log(`[clPrompter] Set ${kwd}_INST${idx}_ELEM${i} to "${input.value}"`);
                    const len = Number.parseInt(String(elem.getAttribute('Len') || ''), 10) || undefined;
                    const inl = Number.parseInt(String(elem.getAttribute('InlPmtLen') || ''), 10) || undefined;
                    ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: String(elemValue ?? '').length });
                }
                else {
                    console.log(`[clPrompter] Input not found for ${kwd}_INST${idx}_ELEM${i}`);
                }
            }
        }
    });
    console.log('[clPrompter] populateElemInputs end');
}
function populateQualInputs(parm, parmMeta, kwd, instance, idx, container) {
    console.log('[clPrompter] populateQualInputs start, instance:', instance);
    const qualNodes = parm.querySelectorAll(':scope > Qual');
    // FIFO into inputs: QUAL0 ← instance[0], QUAL1 ← instance[1], ...
    let i = 0;
    for (;; i++) {
        let input = container.querySelector(`[name="${kwd}_QUAL${i}"]`);
        if (!input)
            break;
        // Check if we found a cbInput container - if so, get the actual input element
        if (input.classList?.contains('cbinput-container')) {
            const actualInput = input.querySelector('.cbinput-input');
            if (actualInput) {
                console.log(`[clPrompter] Found cbInput container, using actual input element`);
                input = actualInput;
            }
        }
        const rawVal = instance[i] ?? '';
        const qNode = qualNodes[i];
        const allowedVals = (state.allowedValsMap || {})[`${kwd}_QUAL${i}`] || [];
        const newVal = normalizeValue(rawVal, allowedVals, qNode);
        console.log(`[clPrompter] Input ${kwd}_QUAL${i}:`, input);
        // Set normalized value
        if (input.value !== newVal) {
            console.log(`[clPrompter] Setting ${kwd}_QUAL${i} from "${input.value}" to "${newVal}" (original: "${rawVal}")`);
            input.value = newVal;
            console.log(`[clPrompter] Set ${kwd}_QUAL${i} to "${input.value}"`);
        }
        const len = Number.parseInt(String(qNode?.getAttribute('Len') || ''), 10) || undefined;
        const inl = Number.parseInt(String(qNode?.getAttribute('InlPmtLen') || ''), 10) || undefined;
        ensureMinInputWidth(input, { len, inlPmtLen: inl, valueLen: newVal.length });
    }
    console.log('[clPrompter] populateQualInputs end');
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
                            let anyQualTouched = false;
                            for (let j = 0;; j++) {
                                const q = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}_QUAL${j}"]`);
                                if (!q)
                                    break;
                                parts.push((q.value || '').trim());
                                if (isFieldTouched(`${kwd}_INST${instIdx}_ELEM${i}_QUAL${j}`)) {
                                    anyQualTouched = true;
                                }
                            }
                            const joined = joinQualParts([...parts].reverse()); // omit empties, no stray '/'
                            console.log(`[DEBUG] ${kwd} ELEM${i} (QUAL): joined="${joined}", anyTouched=${anyQualTouched}`);
                            if (joined) {
                                elemVals.push(joined);
                                // Mark as modified only if any QUAL field was touched
                                if (anyQualTouched) {
                                    lastNonDefaultIndex = i;
                                    console.log(`[DEBUG] ${kwd} ELEM${i}: set lastNonDefaultIndex=${i} (QUAL was touched)`);
                                }
                                else {
                                    console.log(`[DEBUG] ${kwd} ELEM${i}: QUAL not touched, not marking as modified`);
                                }
                            }
                            else {
                                elemVals.push(''); // placeholder to maintain index alignment
                            }
                        }
                        else {
                            const subElems = elem.querySelectorAll(':scope > Elem');
                            if (subElems.length > 0) {
                                // Nested ELEM group - check if any sub field was touched
                                const subVals = [];
                                let anySubTouched = false;
                                subElems.forEach((subElem, j) => {
                                    const input = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}_SUB${j}"]`);
                                    const v = (input?.value || '').trim();
                                    subVals.push(v);
                                    if (v && isFieldTouched(`${kwd}_INST${instIdx}_ELEM${i}_SUB${j}`)) {
                                        anySubTouched = true;
                                    }
                                });
                                // If any sub field was touched, include this nested ELEM group
                                if (anySubTouched) {
                                    const trimmedSubs = subVals.filter(v => v.length > 0);
                                    const joined = '(' + trimmedSubs.join(' ') + ')';
                                    elemVals.push(joined);
                                    lastNonDefaultIndex = i;
                                }
                                else {
                                    elemVals.push(''); // All subs untouched
                                }
                            }
                            else {
                                const input = inst.querySelector(`[name="${kwd}_INST${instIdx}_ELEM${i}"]`);
                                const v = (input?.value || '').trim();
                                const fieldName = `${kwd}_INST${instIdx}_ELEM${i}`;
                                console.log(`[DEBUG] ${kwd} ELEM${i}: input value="${v}", touched=${isFieldTouched(fieldName)}`);
                                if (v) {
                                    elemVals.push(v);
                                    // Mark as modified only if field was touched by user
                                    if (isFieldTouched(fieldName)) {
                                        lastNonDefaultIndex = i;
                                        console.log(`[DEBUG] ${kwd} ELEM${i}: updated lastNonDefaultIndex to ${i} (field was touched)`);
                                    }
                                    else {
                                        console.log(`[DEBUG] ${kwd} ELEM${i}: not touched, not marking as modified`);
                                    }
                                }
                                else {
                                    elemVals.push(''); // placeholder to maintain index alignment
                                    console.log(`[DEBUG] ${kwd} ELEM${i}: empty, pushed placeholder`);
                                }
                            }
                        }
                    });
                    // Only include ELEMs if any were modified (have values)
                    console.log(`[DEBUG] ${kwd} lastNonDefaultIndex=${lastNonDefaultIndex}, elemVals:`, elemVals);
                    const parentInOriginal = wasInOriginalCommand(kwd);
                    console.log(`[DEBUG] ${kwd} wasInOriginalCommand=${parentInOriginal}`);
                    if (lastNonDefaultIndex >= 0) {
                        // Include all ELEM values up to and including the last one with a value
                        const valsToInclude = elemVals.slice(0, lastNonDefaultIndex + 1).filter(v => v.length > 0);
                        console.log(`[DEBUG] ${kwd} valsToInclude:`, valsToInclude);
                        if (valsToInclude.length > 0) {
                            arr.push(valsToInclude);
                        }
                    }
                    else if (parentInOriginal) {
                        // Include all values as-is if parent was in original command
                        const valsToInclude = elemVals.filter(v => v.length > 0);
                        console.log(`[DEBUG] ${kwd} valsToInclude (parentInOriginal):`, valsToInclude);
                        if (valsToInclude.length > 0) {
                            arr.push(valsToInclude);
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
                        const parentInOriginal = wasInOriginalCommand(kwd);
                        for (let i = 0; i < parts.length; i++) {
                            const fieldName = `${kwd}_QUAL${i}`;
                            const userVal = parts[i];
                            // A QUAL is considered "modified" if user touched it OR parent parameter was in original command
                            if (userVal && (isFieldTouched(fieldName) || parentInOriginal)) {
                                lastModifiedIndex = i;
                                console.log(`[DEBUG] ${kwd} QUAL${i}: modified (touched=${isFieldTouched(fieldName)} or parentInOriginal=${parentInOriginal})`);
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
                    // Simple multi-instance parameter - use touch tracking only
                    const input = inst.querySelector(`[name="${kwd}"]`);
                    const v = (input?.value || '').trim();
                    console.log(`[DEBUG] ${kwd} current value: "${v}"`);
                    console.log(`[DEBUG] ${kwd} isFieldTouched: ${isFieldTouched(kwd)}`);
                    console.log(`[DEBUG] ${kwd} wasInOriginalCommand: ${wasInOriginalCommand(kwd)}`);
                    // Include only if: touched OR was in original command
                    if (v && (isFieldTouched(kwd) || wasInOriginalCommand(kwd))) {
                        console.log(`[DEBUG] ${kwd} INCLUDED - touched=${isFieldTouched(kwd)} or wasInOriginal=${wasInOriginalCommand(kwd)}`);
                        arr.push(v);
                    }
                    else {
                        console.log(`[DEBUG] ${kwd} SKIPPED - not touched and not in original command`);
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
                const firstElemInput = document.querySelector(`[name="${kwd}_INST0_ELEM0"]`);
                const firstElemVal = (firstElemInput?.value || '').trim();
                // For parent SngVal exclusivity check, use parent PARM's default
                const parentParmDefault = String(parm.getAttribute('Dft') || '');
                let isFirstElemSpecialAndDefault = false;
                // Check if value matches parent SngVal
                if (firstElemVal && parentSngVals.has(firstElemVal.toUpperCase())) {
                    console.log(`[assembleCommand] ${kwd}: ELEM0="${firstElemVal}" matches parent SngVal`);
                    if (matchesDefault(firstElemVal, parentParmDefault)) {
                        console.log(`[assembleCommand] ${kwd}: matches default "${parentParmDefault}", checking other ELEMs`);
                        // First ELEM matches SngVal AND default - check if other ELEMs have non-default values
                        isFirstElemSpecialAndDefault = true;
                    }
                    else {
                        // SngVal but not default - check if touched or in original command
                        const touched = isFieldTouched(`${kwd}_INST0_ELEM0`);
                        const inOriginal = wasInOriginalCommand(kwd);
                        console.log(`[assembleCommand] ${kwd}: SngVal "${firstElemVal}" != default, touched=${touched}, inOriginal=${inOriginal}`);
                        if (touched || inOriginal) {
                            console.log(`[assembleCommand] ${kwd}="${firstElemVal}" ✅ INCLUDED (SngVal path, touched or in original)`);
                            map[kwd] = firstElemVal;
                        }
                        else {
                            console.log(`[assembleCommand] ${kwd}="${firstElemVal}" ❌ SKIPPED (SngVal path, not touched and not in original)`);
                        }
                        return;
                    }
                }
                else if (elemParts.length > 0) {
                    // Check if value matches first ELEM's SpcVal (acts as single value)
                    const firstElem = elemParts[0];
                    const firstElemSpcVals = getElemSpcVals(firstElem);
                    if (firstElemVal && firstElemSpcVals.has(firstElemVal.toUpperCase())) {
                        console.log(`[assembleCommand] ${kwd}: ELEM0="${firstElemVal}" matches ELEM SpcVal`);
                        if (matchesDefault(firstElemVal, parentParmDefault)) {
                            console.log(`[assembleCommand] ${kwd}: matches default "${parentParmDefault}", checking other ELEMs`);
                            // First ELEM matches SpcVal AND default - check if other ELEMs have non-default values
                            isFirstElemSpecialAndDefault = true;
                        }
                        else {
                            // SpcVal but not default - check if touched or in original command
                            const touched = isFieldTouched(`${kwd}_INST0_ELEM0`);
                            const inOriginal = wasInOriginalCommand(kwd);
                            console.log(`[assembleCommand] ${kwd}: SpcVal "${firstElemVal}" != default, touched=${touched}, inOriginal=${inOriginal}`);
                            if (touched || inOriginal) {
                                console.log(`[assembleCommand] ${kwd}="${firstElemVal}" ✅ INCLUDED (SpcVal path, touched or in original)`);
                                map[kwd] = firstElemVal;
                            }
                            else {
                                console.log(`[assembleCommand] ${kwd}="${firstElemVal}" ❌ SKIPPED (SpcVal path, not touched and not in original)`);
                            }
                            return;
                        }
                    }
                }
                // If first ELEM matches special value AND default, check if ANY other ELEM has non-default value
                // Exclusivity logic removed: Only include parameter if any field was touched or parent was in original command.
                // Assemble single-instance ELEM parameter
                console.log(`[assembleCommand] ${kwd}: Starting ELEM assembly, elemParts.length=${elemParts.length}`);
                const elemVals = [];
                let lastNonDefaultIndex = -1;
                elemParts.forEach((elem, i) => {
                    const elemType = elem.getAttribute('Type') || 'CHAR';
                    const elemDefault = getElemFormDefault(parm, i); // Use form default for output assembly
                    if (elemType === 'QUAL') {
                        const parts = [];
                        let anyQualTouched = false;
                        for (let j = 0;; j++) {
                            const q = document.querySelector(`[name="${kwd}_INST0_ELEM${i}_QUAL${j}"]`);
                            if (!q)
                                break;
                            parts.push((q.value || '').trim());
                            if (isFieldTouched(`${kwd}_INST0_ELEM${i}_QUAL${j}`)) {
                                anyQualTouched = true;
                            }
                        }
                        const joined = joinQualParts([...parts].reverse());
                        console.log(`[assembleCommand] ${kwd}_ELEM${i} (QUAL): joined="${joined}", anyTouched=${anyQualTouched}`);
                        if (joined) {
                            elemVals.push(joined);
                            // Mark as modified only if any QUAL field was touched
                            if (anyQualTouched) {
                                lastNonDefaultIndex = i;
                                console.log(`[assembleCommand] ${kwd}_ELEM${i}: set lastNonDefaultIndex=${i} (QUAL was touched)`);
                            }
                            else {
                                console.log(`[assembleCommand] ${kwd}_ELEM${i}: QUAL not touched, not marking as modified`);
                            }
                        }
                        else {
                            elemVals.push(''); // placeholder to maintain index alignment
                        }
                    }
                    else {
                        const subElems = elem.querySelectorAll(':scope > Elem');
                        if (subElems.length > 0) {
                            // Nested ELEM group - check if any sub field was touched
                            const subVals = [];
                            let anySubTouched = false;
                            subElems.forEach((subElem, j) => {
                                const input = document.querySelector(`[name="${kwd}_INST0_ELEM${i}_SUB${j}"]`);
                                const v = (input?.value || '').trim();
                                subVals.push(v);
                                if (v && isFieldTouched(`${kwd}_INST0_ELEM${i}_SUB${j}`)) {
                                    anySubTouched = true;
                                }
                            });
                            // If any sub field was touched, include this nested ELEM group
                            if (anySubTouched) {
                                const trimmedSubs = subVals.filter(v => v.length > 0);
                                const joined = '(' + trimmedSubs.join(' ') + ')';
                                elemVals.push(joined);
                                lastNonDefaultIndex = i;
                            }
                            else {
                                elemVals.push(''); // All subs untouched
                            }
                        }
                        else {
                            const input = document.querySelector(`[name="${kwd}_INST0_ELEM${i}"]`);
                            const v = (input?.value || '').trim();
                            const fieldName = `${kwd}_INST0_ELEM${i}`;
                            console.log(`[assembleCommand] ${kwd}_ELEM${i}: value="${v}", touched=${isFieldTouched(fieldName)}`);
                            if (v) {
                                elemVals.push(v);
                                // Mark as modified only if field was touched by user
                                if (isFieldTouched(fieldName)) {
                                    lastNonDefaultIndex = i;
                                    console.log(`[assembleCommand] ${kwd}_ELEM${i}: set lastNonDefaultIndex=${i} (field was touched)`);
                                }
                                else {
                                    console.log(`[assembleCommand] ${kwd}_ELEM${i}: not touched, not marking as modified`);
                                }
                            }
                            else {
                                elemVals.push(''); // placeholder to maintain index alignment
                            }
                        }
                    }
                });
                // Only include ELEMs if any were touched OR parent parameter was in original command
                const parentInOriginal = wasInOriginalCommand(kwd);
                console.log(`[assembleCommand] ${kwd}: lastNonDefaultIndex=${lastNonDefaultIndex}, parentInOriginal=${parentInOriginal}, elemVals=`, elemVals);
                if (lastNonDefaultIndex >= 0) {
                    // Usual case: user touched something, include up to last touched
                    const trimmedVals = elemVals.slice(0, lastNonDefaultIndex + 1).filter(v => v.length > 0);
                    const joined = trimmedVals.join(' ');
                    console.log(`[assembleCommand] ${kwd}: ✅ INCLUDING because lastNonDefaultIndex >= 0 (user touched ELEM fields)`);
                    console.log(`[assembleCommand] ${kwd}: trimmedVals=`, trimmedVals, `joined="${joined}"`);
                    if (trimmedVals.length > 0) {
                        // Return as array for proper formatting by extension
                        map[kwd] = trimmedVals;
                        console.log(`[assembleCommand] ${kwd}: ADDED to map as array`, trimmedVals);
                    }
                    else {
                        console.log(`[assembleCommand] ${kwd}: ❌ NOT adding - trimmedVals empty after filtering`);
                    }
                }
                else if (parentInOriginal) {
                    // Special case: present in original command, include all original subfields (even if empty)
                    console.log(`[assembleCommand] ${kwd}: ✅ INCLUDING because parentInOriginal=true (was in original command)`);
                    // Find the number of subfields in the original command
                    let origVals = [];
                    if (state.originalParmMap && state.originalParmMap[kwd]) {
                        const orig = state.originalParmMap[kwd];
                        // Handle string[][] format (standardized parser output)
                        if (Array.isArray(orig) && orig.length > 0 && Array.isArray(orig[0])) {
                            origVals = orig[0]; // First instance for Max=1 parameters
                        }
                        else if (typeof orig === 'string' && orig.startsWith('(') && orig.endsWith(')')) {
                            origVals = orig.slice(1, -1).split(' ');
                        }
                        else if (Array.isArray(orig)) {
                            origVals = orig;
                        }
                        else if (typeof orig === 'string') {
                            origVals = orig.split(' ');
                        }
                    }
                    console.log(`[assembleCommand] ${kwd}: origVals from originalParmMap=`, origVals);
                    // Output as many subfields as were present in the original command
                    const valsToInclude = elemVals.slice(0, Math.max(origVals.length, 1));
                    console.log(`[assembleCommand] ${kwd}: valsToInclude (${valsToInclude.length} elements)=`, valsToInclude);
                    // Do not filter out empty subfields - return as array for proper formatting
                    if (valsToInclude.length > 0) {
                        map[kwd] = valsToInclude;
                        console.log(`[assembleCommand] ${kwd}: ADDED to map (parentInOriginal path)`, valsToInclude);
                    }
                }
                else {
                    console.log(`[assembleCommand] ${kwd}: ❌ NOT including - lastNonDefaultIndex < 0 and not in original command`);
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
                // Simple parameter - use touch tracking only
                const input = document.querySelector(`[name="${kwd}"]`);
                let value = (input?.value || '').trim();
                // Include only if: touched OR was in original command
                const touched = isFieldTouched(kwd);
                const inOriginal = wasInOriginalCommand(kwd);
                // If parameter was in original command but current value is empty,
                // use the original value (handles cases where original value wasn't valid for the form)
                if (!value && inOriginal && state.originalParmMap) {
                    const origVal = state.originalParmMap[kwd];
                    if (origVal) {
                        value = String(origVal);
                        console.log(`[assembleCommand] ${kwd} using original value: ${value} (form value was empty)`);
                    }
                }
                if (value && (touched || inOriginal)) {
                    console.log(`[assembleCommand] ${kwd}=${value} INCLUDED (touched=${touched}, inOriginal=${inOriginal})`);
                    map[kwd] = value;
                }
                else {
                    console.log(`[assembleCommand] ${kwd}=${value || '(empty)'} SKIPPED (touched=${touched}, inOriginal=${inOriginal})`);
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
    // Include label in values if present
    if (state.cmdLabel && state.cmdLabel.trim()) {
        values['label'] = state.cmdLabel;
    }
    // Include comment with delimiters if present
    if (state.cmdComment && state.cmdComment.trim()) {
        values['comment'] = '/* ' + state.cmdComment.trim() + ' */';
    }
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
    const labelInput = document.getElementById('clLabel');
    const commentInput = document.getElementById('cmdComment');
    // Wire up label input
    if (labelInput) {
        // Initialize with current state value
        labelInput.value = state.cmdLabel || '';
        // Listen for changes
        labelInput.addEventListener('input', () => {
            state.cmdLabel = labelInput.value;
        });
    }
    // Wire up comment input
    if (commentInput) {
        // Initialize with current state value (already stripped of delimiters)
        commentInput.value = state.cmdComment || '';
        // Listen for changes
        commentInput.addEventListener('input', () => {
            // Store without delimiters, we'll add them back on submit
            state.cmdComment = commentInput.value.trim();
        });
    }
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
        // Sort parameters by PosNbr to ensure correct display order
        state.parms.sort((a, b) => {
            const posA = parseInt(a.getAttribute('PosNbr') || '9999', 10);
            const posB = parseInt(b.getAttribute('PosNbr') || '9999', 10);
            return posA - posB;
        });
        console.log('[clPrompter] Parsed parms:', state.parms.length); // Add this
        state.allowedValsMap = message.allowedValsMap || {};
        state.cmdName = message.cmdName || '';
        // Update main title with command name and prompt
        const cmdPrompt = message.cmdPrompt || '';
        console.log('[clPrompter] cmdName:', state.cmdName, 'cmdPrompt:', cmdPrompt);
        const mainTitle = document.getElementById('mainTitle');
        if (mainTitle && state.cmdName) {
            // Uppercase the command name for consistent display
            const upperCmdName = state.cmdName.toUpperCase();
            mainTitle.textContent = cmdPrompt ? `${upperCmdName} (${cmdPrompt})` : upperCmdName;
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
    else if (message.type === 'setLabel') {
        // Handle label and comment message
        state.cmdLabel = message.label || '';
        // Strip delimiters from comment before storing in state
        const incomingComment = message.comment || '';
        state.cmdComment = incomingComment ? incomingComment.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim() : '';
        console.log('[clPrompter] Set cmdLabel to:', state.cmdLabel);
        console.log('[clPrompter] Set cmdComment to:', state.cmdComment);
        // Update the HTML inputs
        const labelInput = document.getElementById('clLabel');
        if (labelInput) {
            labelInput.value = state.cmdLabel;
        }
        const commentInput = document.getElementById('cmdComment');
        if (commentInput) {
            commentInput.value = state.cmdComment;
        }
    }
    else if (message.type === 'nestedResult') {
        // Handle nested prompter result - update the field with the returned command string
        console.log('[clPrompter] Received nested result for field:', message.fieldId, 'value:', message.commandString);
        const fieldId = message.fieldId;
        const commandString = message.commandString;
        if (commandString && fieldId) {
            const field = document.querySelector(`[name="${fieldId}"]`);
            if (field && (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT')) {
                console.log('[clPrompter] Updating field', fieldId, 'with value:', commandString);
                field.value = commandString;
                field.focus();
                // Mark as touched
                state.touchedFields.add(fieldId);
                console.log('[clPrompter] Field updated successfully');
            }
            else {
                console.warn('[clPrompter] Could not find field:', fieldId);
            }
        }
        else {
            console.warn('[clPrompter] Invalid nestedResult message:', { fieldId, commandString });
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