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
    elementsToTrack: [], // Elements to attach listeners to after initialization
    convertToUpperCase: true // Default to true (traditional behavior)
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
    // No match in allowed values - preserve original case in prompter
    // Uppercase conversion only happens during command building based on convertToUpperCase setting
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
    errorSpan.className = 'prompter-error-msg';
    // Wrap the input (or container) and error span together so they share the same grid cell
    // This prevents the error span from being pushed outside the CSS grid layout
    const targetElement = container || input;
    const parent = targetElement.parentElement || targetElement.parentNode;
    if (parent) {
        // Create wrapper div to hold both input/container and error span
        const wrapper = document.createElement('div');
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
            input.classList.remove('validation-error');
            errorSpan.classList.remove('visible');
            errorSpan.textContent = '';
            return;
        }
        const valueUpper = input.value.toUpperCase();
        // Allow CL variables (start with &) - no validation needed
        if (input.value.startsWith('&')) {
            input.setCustomValidity('');
            input.style.color = '#006400'; // Valid - dark green
            input.classList.remove('validation-error');
            errorSpan.classList.remove('visible');
            errorSpan.textContent = '';
            return;
        }
        // Check if it's a special value (case-insensitive)
        if (specialValues.some(sv => sv.toUpperCase() === valueUpper)) {
            input.setCustomValidity('');
            input.style.color = '#006400'; // Valid - dark green
            input.classList.remove('validation-error');
            errorSpan.classList.remove('visible');
            errorSpan.textContent = '';
            return;
        }
        // Validate against range
        if (isNumericRange) {
            const numValue = parseFloat(input.value);
            if (!isNaN(numValue) && numValue >= numMin && numValue <= numMax) {
                input.setCustomValidity('');
                input.style.color = '#006400'; // Valid - dark green
                input.classList.remove('validation-error');
                errorSpan.classList.remove('visible');
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
                console.log(`[Range Validation] Looking for wrapper with class parm-validation-wrapper...`);
                const wrapperCheck = input.closest('.parm-validation-wrapper');
                console.log(`[Range Validation] Wrapper found:`, wrapperCheck);
                input.setCustomValidity(errorMsg);
                input.classList.add('validation-error');
                errorSpan.textContent = errorMsg;
                errorSpan.classList.add('visible');
                return;
            }
        }
        else {
            // Alphanumeric range
            if (input.value >= range.min && input.value <= range.max) {
                input.setCustomValidity('');
                input.style.color = '#006400'; // Valid - dark green
                input.classList.remove('validation-error');
                errorSpan.classList.remove('visible');
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
        input.classList.add('validation-error');
        errorSpan.textContent = msg;
        errorSpan.classList.add('visible');
    });
}
// Validate Full="YES" fields - exact length required unless CL variable/expression
function configureFullValidation(input, requiredLength, container) {
    if (!requiredLength || requiredLength <= 0)
        return;
    // Create error message span
    const errorSpan = document.createElement('span');
    errorSpan.className = 'prompter-error-msg';
    // Wrap the input (or container) and error span together
    const targetElement = container || input;
    const parent = targetElement.parentElement || targetElement.parentNode;
    if (parent) {
        // Create wrapper div to hold both input/container and error span
        const wrapper = document.createElement('div');
        wrapper.className = 'parm-validation-wrapper';
        // Insert wrapper before the target element, then move target into wrapper
        parent.replaceChild(wrapper, targetElement);
        wrapper.appendChild(targetElement);
        wrapper.appendChild(errorSpan);
    }
    // Validation logic shared by blur, idle timeout, and Enter key events
    const validateFullLength = () => {
        if (!input.value) {
            input.setCustomValidity('');
            input.style.color = '';
            input.classList.remove('validation-error');
            errorSpan.classList.remove('visible');
            errorSpan.textContent = '';
            return;
        }
        // Allow CL variables or expressions containing &
        if (input.value.includes('&')) {
            input.setCustomValidity('');
            input.style.color = '#006400'; // Valid - dark green
            input.classList.remove('validation-error');
            errorSpan.classList.remove('visible');
            errorSpan.textContent = '';
            return;
        }
        // Validate exact length
        if (input.value.length === requiredLength) {
            input.setCustomValidity('');
            input.style.color = '#006400'; // Valid - dark green
            input.classList.remove('validation-error');
            errorSpan.classList.remove('visible');
            errorSpan.textContent = '';
            return;
        }
        else {
            // Wrong length - show error
            const errorMsg = `Must be exactly ${requiredLength} character${requiredLength !== 1 ? 's' : ''}`;
            input.setCustomValidity(errorMsg);
            input.classList.add('validation-error');
            errorSpan.textContent = errorMsg;
            errorSpan.classList.add('visible');
            return;
        }
    };
    // Add blur handler for Full length validation
    input.addEventListener('blur', validateFullLength);
    // Add Enter key handler to validate before submission
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            validateFullLength();
        }
    });
    // Add debounced validation on idle (500ms after user stops typing)
    let validationTimeout;
    input.addEventListener('input', () => {
        if (validationTimeout) {
            clearTimeout(validationTimeout);
        }
        validationTimeout = window.setTimeout(() => {
            validateFullLength();
        }, 500); // Validate 500ms after user stops typing
    });
}
function setupValidations(input, attrs, container) {
    // Defer all validation setup until after DOM insertion
    // This ensures the input element is in the DOM before we try to wrap it
    setTimeout(() => {
        // Range validation (RangeMinVal/RangeMaxVal)
        if (attrs.suggestions && parseRange(attrs.suggestions)) {
            configureRangeValidation(input, attrs.suggestions, container);
        }
        // Full length validation (Full="YES")
        if (attrs.full?.toUpperCase() === 'YES' && attrs.len) {
            const requiredLength = parseInt(attrs.len, 10);
            if (!isNaN(requiredLength) && requiredLength > 0) {
                configureFullValidation(input, requiredLength, container);
            }
        }
        // Future validations can be added here:
        // if (attrs.minVal) {
        //   configureMinValueValidation(input, attrs.minVal);
        // }
        // if (attrs.maxVal) {
        //   configureMaxValueValidation(input, attrs.maxVal);
        // }
        // if (attrs.values) {
        //   configureValuesValidation(input, attrs.values);
        // }
    }, 0);
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
// Configure tab order to move logically between input fields
// This ensures TAB moves from input to input, not to labels or other elements
function configureTabOrder(focusFirst = true) {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] [configureTabOrder] START (focusFirst=${focusFirst})`);
    // Find all input fields in the form (inputs, textareas, selects, cbinput elements)
    const form = document.getElementById('clForm');
    if (!form) {
        console.warn(`[${ts}] [configureTabOrder] Form not found`);
        return;
    }
    // Get cmdLabel and cmdComment (they're outside the form)
    const cmdLabel = document.getElementById('cmdLabel');
    const cmdComment = document.getElementById('cmdComment');
    // Build the complete list of inputs in desired tab order:
    // 1. cmdLabel (first)
    // 2. All form inputs (in DOM order)
    // 3. cmdComment (last)
    const allInputs = [];
    if (cmdLabel)
        allInputs.push(cmdLabel);
    // Get all focusable input elements from the form in DOM order
    const formInputs = Array.from(form.querySelectorAll('input[type="text"], textarea, select, .cbinput-input'));
    allInputs.push(...formInputs);
    if (cmdComment)
        allInputs.push(cmdComment);
    // Filter out hidden or disabled inputs
    const visibleInputs = allInputs.filter(input => {
        const isVisible = input.offsetParent !== null; // Check if element is visible
        const isDisabled = input.disabled;
        return isVisible && !isDisabled;
    });
    console.log(`[${ts}] [configureTabOrder] Found ${visibleInputs.length} visible input fields`);
    // Set tabindex sequentially (starting from 1)
    visibleInputs.forEach((input, index) => {
        input.tabIndex = index + 1;
        const name = input.name || input.id || 'unnamed';
        console.log(`[${ts}] [configureTabOrder] [${index + 1}] ${name}`);
    });
    // Remove tabindex from ALL labels to ensure they're not in tab order
    const allLabels = document.querySelectorAll('label');
    allLabels.forEach(label => {
        label.removeAttribute('tabindex');
        // Explicitly set tabindex to -1 to remove from tab order
        label.tabIndex = -1;
    });
    // Remove tabindex from cbInput dropdown buttons (actual class is .cbinput-button)
    const dropdownButtons = document.querySelectorAll('.cbinput-button');
    dropdownButtons.forEach(btn => {
        btn.tabIndex = -1;
    });
    // Remove tabindex from multi-instance +/- buttons
    const multiInstanceButtons = document.querySelectorAll('.add-parm-btn, .remove-parm-btn');
    multiInstanceButtons.forEach(btn => {
        btn.tabIndex = -1;
    });
    // Ensure the first input gets focus when form loads (only if requested)
    if (focusFirst && visibleInputs.length > 0) {
        setTimeout(() => {
            visibleInputs[0].focus();
            console.log(`[${ts}] [configureTabOrder] Focused first input: ${visibleInputs[0].name}`);
        }, 100);
    }
    console.log(`[${ts}] [configureTabOrder] COMPLETE - Tab order configured for ${visibleInputs.length} inputs`);
}
/**
 * Add focus indicators (arrow) to all input fields for better visual feedback
 * Shows a small arrow at the right edge of the label, just before the input field
 */
function configureFocusIndicators() {
    const form = document.getElementById('clForm');
    if (!form)
        return;
    const cmdLabel = document.getElementById('cmdLabel');
    const cmdComment = document.getElementById('cmdComment');
    // Get all input elements including static ones (cmdLabel, cmdComment)
    const allInputs = [
        ...Array.from(form.querySelectorAll('input, textarea, .cbinput-input')),
        cmdLabel,
        cmdComment
    ].filter(el => el !== null);
    // Store currently focused element
    const currentlyFocused = document.activeElement;
    allInputs.forEach(input => {
        // Skip if we've already attached listeners (check for data attribute)
        if (input.dataset.focusListenerAttached === 'true') {
            return;
        }
        // Mark as having listeners attached
        input.dataset.focusListenerAttached = 'true';
        // Add focus event listener
        input.addEventListener('focus', () => {
            const inputName = input.name || input.className;
            console.log('[focus] Input:', inputName);
            // Find the associated label FIRST
            // For combined parameters (dropdown + textarea), the label is in the form-group that contains the textarea-cbinput-container
            let parent = input.closest('.form-group');
            let label = parent?.querySelector('label');
            // If input is inside a textarea-cbinput-container, get the label from the parent form-group
            const container = input.closest('.textarea-cbinput-container');
            if (container) {
                parent = container.closest('.form-group');
                label = parent?.querySelector('label');
            }
            console.log('[focus] Parent found?', !!parent, 'Label found?', !!label);
            console.log('[focus] Parent classList:', parent?.classList.toString());
            if (container)
                console.log('[focus] Inside textarea-cbinput-container');
            // Check if THIS label already has an indicator (kept from blur event)
            let existingIndicator = label?.querySelector('.focus-indicator');
            // Remove any indicators from OTHER labels (not this one)
            const allIndicators = document.querySelectorAll('.focus-indicator');
            console.log('[focus] Found', allIndicators.length, 'existing indicators');
            allIndicators.forEach(ind => {
                if (ind.parentElement !== label) {
                    console.log('[focus] Removing indicator from other label');
                    ind.remove();
                }
            });
            // If this label already has an indicator, make sure it's visible and return
            if (existingIndicator && existingIndicator.parentElement === label) {
                console.log('[focus] ✓ Label already has indicator, enforcing visibility with !important');
                const indicatorEl = existingIndicator;
                // Use !important to override any CSS that might hide it
                indicatorEl.style.setProperty('display', 'inline', 'important');
                indicatorEl.style.setProperty('visibility', 'visible', 'important');
                indicatorEl.style.setProperty('opacity', '1', 'important');
                return; // Don't create a new one
            }
            if (label) {
                console.log('[focus] ✓ Adding indicator to label:', label.textContent?.substring(0, 30));
                // Float the indicator right with a small margin to keep it visible
                const indicator = document.createElement('span');
                indicator.className = 'focus-indicator';
                indicator.textContent = '▶';
                indicator.style.float = 'right';
                indicator.style.color = 'var(--vscode-focusBorder, #0066cc)';
                indicator.style.fontSize = '14px';
                indicator.style.fontWeight = 'bold';
                indicator.style.marginRight = '5px'; // Keep close to input field
                indicator.style.pointerEvents = 'none';
                label.appendChild(indicator);
            }
            else {
                console.log('[focus] ✗ No label found for input');
            }
        });
        // Add blur event listener
        input.addEventListener('blur', (e) => {
            // Check if focus is moving to another input in the same form-group
            const relatedTarget = e.relatedTarget;
            const inputName = input.name || input.className;
            const targetName = relatedTarget?.name || relatedTarget?.className;
            console.log('[blur] Input:', inputName, 'relatedTarget:', targetName);
            // If focus is moving to another input in the same group, don't remove the indicator
            // Check both the form-group and the textarea-cbinput-container
            if (relatedTarget) {
                const parentFormGroup = input.closest('.form-group');
                const relatedFormGroup = relatedTarget.closest('.form-group');
                const parentContainer = input.closest('.textarea-cbinput-container');
                const relatedContainer = relatedTarget.closest('.textarea-cbinput-container');
                console.log('[blur] Same form-group?', parentFormGroup === relatedFormGroup);
                console.log('[blur] Same container?', parentContainer === relatedContainer, parentContainer && relatedContainer);
                // Keep indicator if moving within same form-group OR same textarea-cbinput-container
                if ((parentFormGroup && parentFormGroup === relatedFormGroup) ||
                    (parentContainer && parentContainer === relatedContainer)) {
                    console.log('[blur] ✓ Keeping indicator - focus staying in same group');
                    return;
                }
            }
            // If relatedTarget is undefined, wait briefly to see where focus actually went
            // This handles cases where the textarea briefly loses focus but regains it
            if (!relatedTarget) {
                console.log('[blur] relatedTarget undefined, checking activeElement after delay');
                setTimeout(() => {
                    const newFocus = document.activeElement;
                    const newFocusName = newFocus?.name || newFocus?.className;
                    console.log('[blur-delayed] activeElement is now:', newFocusName);
                    // If focus is still on the same input, don't remove indicator
                    if (newFocus === input) {
                        console.log('[blur-delayed] ✓ Focus still on same input, keeping indicator');
                        return;
                    }
                    // Check if the new focus is in the same container
                    const parentContainer = input.closest('.textarea-cbinput-container');
                    const newFocusContainer = newFocus?.closest('.textarea-cbinput-container');
                    if (parentContainer && parentContainer === newFocusContainer) {
                        console.log('[blur-delayed] ✓ Focus returned to same container, keeping indicator');
                        return;
                    }
                    // Remove indicator if focus has truly left
                    console.log('[blur-delayed] ✗ Removing indicator');
                    const parent = parentContainer ? parentContainer.closest('.form-group') : input.closest('.form-group');
                    const label = parent?.querySelector('label');
                    if (label) {
                        const indicator = label.querySelector('.focus-indicator');
                        if (indicator) {
                            indicator.remove();
                        }
                    }
                }, 50);
                return;
            }
            console.log('[blur] ✗ Removing indicator');
            // Remove the indicator from the label
            // For combined parameters, look up to the form-group containing the textarea-cbinput-container
            let parent = input.closest('.form-group');
            const container = input.closest('.textarea-cbinput-container');
            if (container) {
                parent = container.closest('.form-group');
            }
            const label = parent?.querySelector('label');
            if (label) {
                const indicator = label.querySelector('.focus-indicator');
                if (indicator) {
                    indicator.remove();
                }
            }
        });
    });
    // Restore focus to the previously focused element or trigger indicator on current focus
    if (currentlyFocused && allInputs.includes(currentlyFocused)) {
        // Trigger the focus event to show indicator
        currentlyFocused.dispatchEvent(new FocusEvent('focus'));
    }
}
function createInputForType(type, name, dft, len, suggestions, isRestricted = false, full) {
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
        container.className = 'textarea-cbinput-container';
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
            // Configure all validations (range, full, future validations)
            setupValidations(input, { suggestions, full, len });
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
        // Add blur handler for VARNAME validation only (no case conversion)
        console.log('[createInputForType] Attaching blur handler to:', name, 'type:', type);
        input.addEventListener('blur', () => {
            console.log('[blur handler] Fired for:', input.name, 'value:', input.value, 'type:', type);
            const typeUpper = type.toUpperCase();
            // Type=VARNAME validation: must start with & and be max 11 chars total
            // Do NOT uppercase - let the command builder handle that
            if (typeUpper === 'VARNAME' && input.value) {
                console.log('[blur handler] VARNAME validation - original value:', input.value);
                let normalized = input.value;
                if (!normalized.startsWith('&')) {
                    // Automatically prepend & if missing
                    normalized = '&' + normalized;
                }
                // Enforce 11 character max (& + 10 chars)
                if (normalized.length > 11) {
                    normalized = normalized.substring(0, 11);
                }
                if (normalized !== input.value) {
                    input.value = normalized;
                    console.log('[blur handler] VARNAME adjusted to:', input.value);
                }
            }
            // Note: Case conversion is handled by buildCLCommand() based on convertVarsToUpperCase setting
        });
        // Configure all validations (range, full, future validations)
        setupValidations(input, { suggestions, full, len });
        return input;
    }
}
// Create parm input (cbInput or textfield for all parameters to support CL variables)
function createParmInput(name, suggestions, isRestricted, dft, len, type, full) {
    console.log(`[createParmInput] ${name}: suggestions=`, suggestions, 'isRestricted=', isRestricted, 'type=', type, 'full=', full);
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
        return createInputForType(type || 'CHAR', name, dft, len || '', suggestions, isRestricted, full);
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
    const full = String(qual?.getAttribute('Full') || '');
    const input = createParmInput(qualName, allowedVals, restricted, dft, qualLen, qualType, full);
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
    const full = String(elem?.getAttribute('Full') || '');
    const input = createParmInput(elemName, allowedVals, restricted, dft, elemLen, elemType, full);
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
    const fullAttr = String(parm.getAttribute('Full') || '');
    const inlPmtLen = String(parm.getAttribute('InlPmtLen') || '');
    // Use Len if available, otherwise fall back to InlPmtLen (for types like CMD, PNAME, etc.)
    const effectiveLenAttr = lenAttr || inlPmtLen;
    const inputName = kwd;
    const allowedVals = (state.allowedValsMap || {})[inputName] || [];
    const restricted = isRestricted(parm);
    const len = Number.parseInt(lenAttr, 10) || undefined;
    const inl = Number.parseInt(inlPmtLen, 10) || undefined;
    const input = createParmInput(inputName, allowedVals, restricted, dft, effectiveLenAttr, type, fullAttr);
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
    // EIGHTH FIX: If input is a textarea-cbinput-container, create a separate form-group for the textarea
    // This gives the textarea its own label for the focus indicator
    if (input instanceof HTMLElement && input.classList.contains('textarea-cbinput-container')) {
        const textarea = input.querySelector('textarea');
        if (textarea) {
            // Remove textarea from container (leave dropdown in original form-group)
            input.removeChild(textarea);
            // Create a new form-group for the textarea
            const textareaFormGroup = document.createElement('div');
            textareaFormGroup.className = 'form-group simple-parm-group';
            // Create an empty label to maintain grid alignment and provide a target for focus indicator
            const textareaLabel = document.createElement('label');
            textareaLabel.textContent = ''; // Empty label
            textareaLabel.htmlFor = textarea.name;
            textareaFormGroup.appendChild(textareaLabel);
            textareaFormGroup.appendChild(textarea);
            // Append both form-groups to div
            div.appendChild(formGroup);
            div.appendChild(textareaFormGroup);
            container.appendChild(div);
            return; // Early return since we've handled the append
        }
    }
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
        // Split textarea-cbinput-container into two form-groups
        if (input instanceof HTMLElement && input.classList.contains('textarea-cbinput-container')) {
            const textarea = input.querySelector('textarea');
            if (textarea) {
                input.removeChild(textarea); // Remove from container, leave dropdown
                // Create new form-group for textarea
                const textareaQualDiv = document.createElement('div');
                textareaQualDiv.className = 'form-group';
                // Empty label for grid alignment
                const textareaLabel = document.createElement('label');
                textareaLabel.textContent = '';
                textareaLabel.htmlFor = textarea.name;
                textareaQualDiv.appendChild(textareaLabel);
                textareaQualDiv.appendChild(textarea);
                container.appendChild(qualDiv);
                container.appendChild(textareaQualDiv);
            }
            else {
                container.appendChild(qualDiv);
            }
        }
        else {
            container.appendChild(qualDiv);
        }
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
                // Split textarea-cbinput-container into two form-groups
                if (input instanceof HTMLElement && input.classList.contains('textarea-cbinput-container')) {
                    const textarea = input.querySelector('textarea');
                    if (textarea) {
                        input.removeChild(textarea); // Remove from container, leave dropdown
                        // Create new form-group for textarea
                        const textareaQualDiv = document.createElement('div');
                        textareaQualDiv.className = 'form-group';
                        // Empty label for grid alignment
                        const textareaLabel = document.createElement('label');
                        textareaLabel.textContent = '';
                        textareaLabel.htmlFor = textarea.name;
                        textareaQualDiv.appendChild(textareaLabel);
                        textareaQualDiv.appendChild(textarea);
                        fieldset.appendChild(qualDiv);
                        fieldset.appendChild(textareaQualDiv);
                    }
                    else {
                        fieldset.appendChild(qualDiv);
                    }
                }
                else {
                    fieldset.appendChild(qualDiv);
                }
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
                    // Split textarea-cbinput-container into two form-groups
                    if (input instanceof HTMLElement && input.classList.contains('textarea-cbinput-container')) {
                        const textarea = input.querySelector('textarea');
                        if (textarea) {
                            input.removeChild(textarea); // Remove from container, leave dropdown
                            // Create new form-group for textarea
                            const textareaSubDiv = document.createElement('div');
                            textareaSubDiv.className = 'form-group';
                            // Empty label for grid alignment
                            const textareaLabel = document.createElement('label');
                            textareaLabel.textContent = '';
                            textareaLabel.htmlFor = textarea.name;
                            textareaSubDiv.appendChild(textareaLabel);
                            textareaSubDiv.appendChild(textarea);
                            elemDiv.appendChild(subDiv);
                            elemDiv.appendChild(textareaSubDiv);
                        }
                        else {
                            elemDiv.appendChild(subDiv);
                        }
                    }
                    else {
                        elemDiv.appendChild(subDiv);
                    }
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
                // Split textarea-cbinput-container into two form-groups (same fix as renderSimpleParm)
                if (input instanceof HTMLElement && input.classList.contains('textarea-cbinput-container')) {
                    const textarea = input.querySelector('textarea');
                    if (textarea) {
                        input.removeChild(textarea); // Remove from container, leave dropdown
                        // Create new form-group for textarea
                        const textareaElemDiv = document.createElement('div');
                        textareaElemDiv.className = 'form-group';
                        // Empty label for grid alignment
                        const textareaLabel = document.createElement('label');
                        textareaLabel.textContent = '';
                        textareaLabel.htmlFor = textarea.name;
                        textareaElemDiv.appendChild(textareaLabel);
                        textareaElemDiv.appendChild(textarea);
                        fieldset.appendChild(elemDiv);
                        fieldset.appendChild(textareaElemDiv);
                    }
                    else {
                        fieldset.appendChild(elemDiv);
                    }
                }
                else {
                    fieldset.appendChild(elemDiv);
                }
            }
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
        addBtn.tabIndex = -1; // Remove from tab order
        addBtn.onclick = () => {
            const instances = multiGroupDiv.querySelectorAll('.parm-instance');
            if (instances.length < max) {
                const newIdx = instances.length;
                const newInst = renderParmInstance(parm, kwd, newIdx, max, multiGroupDiv);
                multiGroupDiv.appendChild(newInst);
                // Apply dark green color to new instance if it was in the original command
                const newInput = newInst.querySelector('input[name], textarea[name]');
                console.log('[+ button] New input:', newInput, 'name:', newInput?.name, 'wasInOriginalCommand:', wasInOriginalCommand(newInput?.name || ''));
                if (newInput && wasInOriginalCommand(newInput.name)) {
                    console.log('[+ button] Applying dark green color to:', newInput.name);
                    newInput.style.color = '#006400';
                }
                else {
                    console.log('[+ button] NOT applying color. newInput:', !!newInput, 'wasInOriginalCommand:', wasInOriginalCommand(newInput?.name || ''));
                }
                // Reconfigure tab order to include the newly added instance
                configureTabOrder(false);
                // Reconfigure focus indicators for newly added elements
                configureFocusIndicators();
                // Focus the newly added input
                if (newInput) {
                    setTimeout(() => newInput.focus(), 50);
                }
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
        removeBtn.tabIndex = -1; // Remove from tab order
        removeBtn.onclick = () => {
            // Remember which element had focus
            const activeElement = document.activeElement;
            const wasInputInRemovedContainer = container.contains(activeElement);
            container.remove();
            // Reconfigure tab order after removing instance (without forcing focus)
            configureTabOrder(false);
            // Reconfigure focus indicators after removing
            configureFocusIndicators();
            // If the removed container had focus, focus the next available input
            if (wasInputInRemovedContainer) {
                const nextInput = multiGroupDiv.querySelector('input[name], textarea[name]');
                if (nextInput) {
                    setTimeout(() => nextInput.focus(), 50);
                }
            }
        };
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
    configureTabOrder(); // Configure tab navigation to move between input fields
    configureFocusIndicators(); // Add visual focus indicators (arrows) to all inputs
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
    // Add 2ch padding, but ensure a minimum of 10ch to accommodate static "Label:" and "Comment:" fields
    // Cap at 50ch (don't exceed current max)
    const optimalWidth = Math.max(Math.min(maxLength + 2, 50), 10);
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
    configureTabOrder(); // Configure tab navigation to move between input fields
    configureFocusIndicators(); // Add visual focus indicators (arrows) to all inputs
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
            // elemValue for QUAL can be:
            // 1. A string like "LIB/FILE" that needs to be split
            // 2. Already an array ["FILE", "LIB"] from parser (for ELEM containing QUAL)
            let qualParts;
            if (Array.isArray(elemValue)) {
                qualParts = elemValue; // Already split by parser
                console.log(`[clPrompter] QUAL is already array:`, qualParts);
            }
            else {
                qualParts = splitQualLeftToRight(elemValue); // Split the string
                console.log(`[clPrompter] QUAL split from string "${elemValue}":`, qualParts);
            }
            // Use full name with INST for consistency with webview input naming
            populateQualInputs(elem, parmMeta, `${kwd}_INST${idx}_ELEM${i}`, qualParts, idx, container);
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
// Helper function to normalize newlines in all values (from textarea fields)
function normalizeNewlinesInValues(values) {
    console.log('[clPrompter] normalizeNewlinesInValues - START');
    for (const key in values) {
        const value = values[key];
        console.log(`[clPrompter] normalizeNewlines checking key: ${key}, type: ${typeof value}, isArray: ${Array.isArray(value)}`);
        if (typeof value === 'string') {
            const hasNewline = /\r\n|\n|\r/.test(value);
            if (hasNewline) {
                console.log(`[clPrompter] normalizeNewlines FOUND newline in ${key}, before: ${JSON.stringify(value)}`);
                values[key] = value.replace(/\r\n|\n|\r/g, ' ');
                console.log(`[clPrompter] normalizeNewlines after: ${JSON.stringify(values[key])}`);
            }
        }
        else if (Array.isArray(value)) {
            // Handle arrays (multi-instance parameters)
            values[key] = value.map(item => {
                if (typeof item === 'string') {
                    return item.replace(/\r\n|\n|\r/g, ' ');
                }
                else if (Array.isArray(item)) {
                    // Handle nested arrays (QUAL parameters)
                    return item.map(subItem => typeof subItem === 'string' ? subItem.replace(/\r\n|\n|\r/g, ' ') : subItem);
                }
                return item;
            });
        }
    }
    console.log('[clPrompter] normalizeNewlinesInValues - END');
}
// Event handlers
function onSubmit() {
    console.log('[clPrompter] ', 'onSubmit (Enter) start');
    const values = assembleCurrentParmMap();
    // Normalize newlines in all parameter values (textarea fields can have Shift+Enter)
    normalizeNewlinesInValues(values);
    // Include label in values if present (normalize newlines just in case)
    if (state.cmdLabel && state.cmdLabel.trim()) {
        values['label'] = state.cmdLabel.replace(/\r\n|\n|\r/g, ' ').trim();
    }
    // Include comment with delimiters if present (normalize newlines)
    if (state.cmdComment && state.cmdComment.trim()) {
        const normalizedComment = state.cmdComment.replace(/\r\n|\n|\r/g, ' ').trim();
        values['comment'] = '/* ' + normalizedComment + ' */';
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
    const labelInput = document.getElementById('cmdLabel');
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
        // Trap Tab key on submit button to wrap back to first input
        submitBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                if (labelInput) {
                    labelInput.focus();
                }
            }
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', onCancel);
    }
    // Trap Shift+Tab on first input to wrap to comment field
    if (labelInput && commentInput) {
        labelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && e.shiftKey) {
                e.preventDefault();
                commentInput.focus();
            }
        });
    }
    if (form) {
        form.addEventListener('submit', e => {
            e.preventDefault();
            onSubmit();
        });
    }
    document.addEventListener('keydown', e => {
        const target = e.target;
        // Handle Enter in any input field or textarea
        if (e.key === 'Enter' && !e.shiftKey && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
            // For textareas, Enter should submit (not add newline) unless Shift is pressed
            // For regular inputs, Enter should submit the form
            e.preventDefault();
            if (form) {
                console.log('[Enter key] Submitting form from:', target.tagName, 'name:', target.name);
                form.requestSubmit();
            }
        }
        else if (e.key === 'Escape' || e.key === 'F3') {
            e.preventDefault();
            onCancel();
        }
        // Shift+Enter in textareas: allow newline (don't preventDefault above)
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
        // Store the convertToUpperCase setting
        if (config && typeof config.convertToUpperCase === 'boolean') {
            state.convertToUpperCase = config.convertToUpperCase;
            console.log('[clPrompter] convertToUpperCase set to:', state.convertToUpperCase);
        }
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
        const labelInput = document.getElementById('cmdLabel');
        if (labelInput) {
            labelInput.value = state.cmdLabel;
        }
        const commentInput = document.getElementById('cmdComment');
        if (commentInput) {
            commentInput.value = state.cmdComment;
        }
        // If formData hasn't been processed yet, this is a label-only prompter
        // Wire up controls so submit/cancel buttons work
        if (!state.hasProcessedFormData) {
            console.log('[clPrompter] Label-only prompter detected, wiring controls');
            state.hasProcessedFormData = true;
            wirePrompterControls();
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
    else if (message.type === 'ping') {
        // Respond to ping to confirm webview is alive and responsive
        console.log('[clPrompter] Received ping, sending pong');
        vscode?.postMessage({ type: 'pong', hasProcessedFormData: state.hasProcessedFormData });
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