/**
 * Custom Combobox Input Component
 * A self-contained editable combobox with dropdown list
 * No external dependencies, no filtering
 */
export class CBInput {
    constructor(opts) {
        this.isOpen = false;
        this.options = opts.options || [];
        // Create main container
        this.container = document.createElement('div');
        this.container.className = 'cbinput-container';
        this.container.style.position = 'relative';
        this.container.style.display = 'inline-flex';
        this.container.style.alignItems = 'flex-start';
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
        // After adding to DOM, measure input height and apply to button
        requestAnimationFrame(() => {
            const inputHeight = this.input.offsetHeight;
            this.button.style.height = `${inputHeight}px`;
        });
        // Attach event listeners
        this.attachListeners();
    }
    renderOptions() {
        this.dropdown.innerHTML = '';
        this.options.forEach(optionValue => {
            const optionEl = document.createElement('div');
            optionEl.className = 'cbinput-option';
            optionEl.textContent = optionValue;
            optionEl.setAttribute('data-value', optionValue);
            optionEl.style.padding = '4px 8px';
            optionEl.style.cursor = 'pointer';
            optionEl.style.color = '#006400';
            optionEl.style.fontFamily = 'var(--vscode-font-family, monospace)';
            optionEl.style.fontSize = '13px';
            // Hover effect
            optionEl.addEventListener('mouseenter', () => {
                optionEl.style.background = '#e0e0e0';
            });
            optionEl.addEventListener('mouseleave', () => {
                optionEl.style.background = '';
            });
            // Click to select
            optionEl.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent input blur
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
        // Input focus behavior
        this.input.addEventListener('focus', () => {
            this.input.style.borderColor = 'var(--vscode-focusBorder, #007acc)';
        });
        this.input.addEventListener('blur', () => {
            this.input.style.borderColor = 'var(--vscode-input-border, #3c3c3c)';
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
    }
    closeDropdown() {
        this.dropdown.style.display = 'none';
        this.isOpen = false;
        this.button.textContent = '▼';
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
    }
    setOptions(options) {
        this.options = options;
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