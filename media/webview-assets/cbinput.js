/*
 * MIT License
 *
 * Copyright (c) 2026 R. Cozzi, Jr.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export function cbinputResolveHighlightIndex(options, value) {
    return options.indexOf(value);
}
export function cbinputMoveIndex(options, highlightedIndex, direction) {
    if (options.length === 0)
        return -1;
    if (direction === 'next') {
        return highlightedIndex + 1 >= options.length ? 0 : highlightedIndex + 1;
    }
    return highlightedIndex - 1 < 0 ? options.length - 1 : highlightedIndex - 1;
}
export class CBInput {
    syncHighlightedIndexToCurrentValue() {
        this.highlightedIndex = cbinputResolveHighlightIndex(this.options, this.input.value);
        if (this.isOpen) {
            this.refreshDropdownHighlight();
        }
    }
    constructor(opts) {
        this.isOpen = false;
        this.highlightedIndex = -1; // Current option highlighted in the dropdown
        this.justFocused = false; // First arrow key after focus overrides browser selection collapse
        this.options = opts.options || [];
        // Create main container
        this.container = document.createElement('div');
        this.container.className = 'cbinput-container';
        this.container.style.position = 'relative';
        this.container.style.display = 'inline-flex';
        this.container.style.alignItems = 'stretch';
        this.container.style.width = opts.width || 'auto';
        this.container.style.minWidth = opts.minWidth || '150px';
        // Create text input - match styling of other input elements
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.name = opts.name;
        this.input.id = opts.id || opts.name;
        this.input.value = opts.value || '';
        this.input.placeholder = opts.placeholder || '';
        this.input.className = 'cbinput-input';
        this.input.style.flex = '1';
        this.input.style.minWidth = '0';
        this.input.style.padding = '2px 5px';
        this.input.style.border = '1px solid #3c3c3c';
        this.input.style.background = '#ffffff';
        this.input.style.color = '#000000';
        this.input.style.fontFamily = 'var(--vscode-font-family, monospace)';
        this.input.style.fontSize = '13px';
        this.input.style.borderTopRightRadius = '0';
        this.input.style.borderBottomRightRadius = '0';
        this.input.style.outline = 'none';
        this.input.style.boxSizing = 'border-box';
        this.input.style.margin = '0';
        this.input.style.verticalAlign = 'top';
        // Create dropdown button - will size to match input after rendering
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'cbinput-button';
        this.button.textContent = '▼';
        this.button.tabIndex = -1; // Exclude from tab order - only the input should be tabbable
        this.button.style.padding = '0 6px';
        this.button.style.lineHeight = '1';
        this.button.style.fontSize = '9px';
        this.button.style.border = '1px solid #3c3c3c';
        this.button.style.borderLeft = 'none';
        this.button.style.background = '#3a3d41';
        this.button.style.color = '#cccccc';
        this.button.style.cursor = 'pointer';
        this.button.style.borderTopRightRadius = '2px';
        this.button.style.borderBottomRightRadius = '2px';
        this.button.style.outline = 'none';
        this.button.style.boxSizing = 'border-box';
        this.button.style.margin = '0';
        this.button.style.verticalAlign = 'top';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        // Create dropdown list
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'cbinput-dropdown';
        this.dropdown.style.position = 'absolute';
        this.dropdown.style.top = '100%';
        this.dropdown.style.left = '0';
        this.dropdown.style.right = '0';
        this.dropdown.style.marginTop = '2px';
        this.dropdown.style.maxHeight = '200px';
        this.dropdown.style.overflowY = 'auto';
        this.dropdown.style.background = '#ffffff';
        this.dropdown.style.border = '1px solid #3c3c3c';
        this.dropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        this.dropdown.style.zIndex = '1000';
        this.dropdown.style.display = 'none';
        // Populate dropdown options
        this.renderOptions();
        // Assemble component
        this.container.appendChild(this.input);
        this.container.appendChild(this.button);
        this.container.appendChild(this.dropdown);
        // Attach event listeners
        this.attachListeners();
    }
    renderOptions() {
        this.dropdown.innerHTML = '';
        this.options.forEach((optionValue, index) => {
            const optionEl = document.createElement('div');
            optionEl.className = 'cbinput-option';
            optionEl.textContent = optionValue;
            optionEl.setAttribute('data-value', optionValue);
            optionEl.setAttribute('data-index', String(index));
            optionEl.style.padding = '4px 8px';
            optionEl.style.cursor = 'pointer';
            optionEl.style.color = '#006400';
            optionEl.style.fontFamily = 'var(--vscode-font-family, monospace)';
            optionEl.style.fontSize = '13px';
            optionEl.style.transition = 'background 0.1s ease';
            // Highlight current selection if this index matches
            if (index === this.highlightedIndex) {
                optionEl.style.background = '#0e639c'; // VS Code selection blue
                optionEl.style.color = '#ffffff';
            }
            // Hover effect
            optionEl.addEventListener('mouseenter', () => {
                optionEl.style.background = '#e0e0e0';
                optionEl.style.color = '#000000';
            });
            optionEl.addEventListener('mouseleave', () => {
                // Restore highlighting if this was the current selection
                if (index === this.highlightedIndex) {
                    optionEl.style.background = '#0e639c';
                    optionEl.style.color = '#ffffff';
                }
                else {
                    optionEl.style.background = '';
                    optionEl.style.color = '#006400';
                }
            });
            // Click to select
            optionEl.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent input blur
                this.highlightedIndex = index;
                this.selectOption(optionValue);
            });
            this.dropdown.appendChild(optionEl);
        });
    }
    attachListeners() {
        // Button toggles dropdown
        this.button.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleDropdown();
        });
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });
        // Keep select-all on focus so users can type over the current value.
        // The first arrow key after focus is handled specially to override the browser's
        // native selection-collapse behavior.
        this.input.addEventListener('focus', () => {
            this.input.style.borderColor = 'var(--vscode-focusBorder, #007acc)';
            this.justFocused = true;
            this.syncHighlightedIndexToCurrentValue();
            this.input.select();
        });
        this.input.addEventListener('blur', () => {
            this.input.style.borderColor = 'var(--vscode-input-border, #3c3c3c)';
            this.justFocused = false;
        });
        // Keyboard navigation for the dropdown list.
        this.input.addEventListener('keydown', (e) => {
            if (this.options.length === 0)
                return;
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (this.justFocused) {
                        this.justFocused = false;
                        const endPos = this.input.value.length;
                        this.input.setSelectionRange(endPos, endPos);
                        this.highlightNext();
                        this.refreshDropdownHighlight();
                        return;
                    }
                    this.highlightNext();
                    this.refreshDropdownHighlight();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (this.justFocused) {
                        this.justFocused = false;
                        const endPos = this.input.value.length;
                        this.input.setSelectionRange(endPos, endPos);
                        this.highlightPrevious();
                        this.refreshDropdownHighlight();
                        return;
                    }
                    this.highlightPrevious();
                    this.refreshDropdownHighlight();
                    break;
                case 'Enter':
                    if (this.highlightedIndex >= 0 && this.highlightedIndex < this.options.length) {
                        e.preventDefault();
                        this.selectOption(this.options[this.highlightedIndex]);
                    }
                    break;
                case 'Escape':
                    if (this.isOpen) {
                        e.preventDefault();
                        this.closeDropdown();
                    }
                    break;
                default:
                    this.justFocused = false;
                    this.highlightedIndex = -1;
                    break;
            }
        });
    }
    highlightNext() {
        this.highlightedIndex = cbinputMoveIndex(this.options, this.highlightedIndex, 'next');
        this.updateInputToHighlighted();
    }
    highlightPrevious() {
        this.highlightedIndex = cbinputMoveIndex(this.options, this.highlightedIndex, 'previous');
        this.updateInputToHighlighted();
    }
    updateInputToHighlighted() {
        if (this.highlightedIndex >= 0 && this.highlightedIndex < this.options.length) {
            this.input.value = this.options[this.highlightedIndex];
        }
    }
    refreshDropdownHighlight() {
        // Update visual highlight in dropdown if it's open
        if (!this.isOpen)
            return;
        const options = this.dropdown.querySelectorAll('.cbinput-option');
        options.forEach((option, index) => {
            const optionEl = option;
            if (index === this.highlightedIndex) {
                optionEl.style.background = '#0e639c'; // VS Code selection blue
                optionEl.style.color = '#ffffff';
            }
            else {
                optionEl.style.background = '';
                optionEl.style.color = '#006400';
            }
        });
    }
    toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        }
        else {
            this.openDropdown();
        }
    }
    openDropdown() {
        this.dropdown.style.display = 'block';
        this.isOpen = true;
        this.button.textContent = '▲';
        // Initialize highlighting to first option if none is selected
        if (this.highlightedIndex < 0 && this.options.length > 0) {
            this.highlightedIndex = 0;
            this.updateInputToHighlighted();
        }
        this.refreshDropdownHighlight();
    }
    closeDropdown() {
        this.dropdown.style.display = 'none';
        this.isOpen = false;
        this.button.textContent = '▼';
        this.highlightedIndex = -1; // Reset navigation index
    }
    selectOption(value) {
        this.input.value = value;
        this.closeDropdown();
        this.input.focus();
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        this.input.dispatchEvent(event);
    }
    getElement() {
        return this.container;
    }
    getValue() {
        return this.input.value;
    }
    setValue(value) {
        this.input.value = value;
        this.syncHighlightedIndexToCurrentValue();
    }
    setOptions(options) {
        this.options = options;
        this.syncHighlightedIndexToCurrentValue();
        this.renderOptions();
    }
    getInputElement() {
        return this.input;
    }
}
// Factory function for easy creation
export function createCBInput(opts) {
    return new CBInput(opts);
}
//# sourceMappingURL=cbinput.js.map