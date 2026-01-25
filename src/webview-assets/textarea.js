
export function createTextareaWithCombobox(name, value, maxLength, allowedVals) {
    const textarea = document.createElement('vscode-textarea');
    textarea.name = name;
    textarea.value = value || '';
    textarea.setAttribute('maxlength', maxLength);

    if (allowedVals && allowedVals.length > 1) {
        const combo = document.createElement('vscode-single-select');
        combo.name = name + '_combo';
        combo.style.display = 'none';
        allowedVals.forEach(val => {
            const option = document.createElement('vscode-option');
            option.value = val;
            option.textContent = val;
            combo.appendChild(option);
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'F4') {
                e.preventDefault();
                let found = false;
                for (let i = 0; i < combo.options.length; i++) {
                    if (combo.options[i].value === textarea.value) {
                        combo.selectedIndex = i;
                        found = true;
                        break;
                    }
                }
                if (!found) combo.selectedIndex = -1;
                combo.style.display = '';
                combo.style.position = 'absolute';
                combo.style.zIndex = 1000;
                textarea.parentNode.appendChild(combo);
                combo.focus();
                textarea.style.display = 'none';
            }
        });

        combo.addEventListener('change', () => {
            textarea.value = combo.value;
            combo.style.display = 'none';
            textarea.style.display = '';
            combo.remove();
            textarea.focus();
        });

        combo.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                combo.style.display = 'none';
                textarea.style.display = '';
                combo.remove();
                textarea.focus();
            }
        });
    }

    return textarea;
}

export function createHiddenCombobox(name, allowedVals) {
    const combo = document.createElement('vscode-single-select');
    combo.name = name + '_combo';
    combo.style.display = 'none';
    allowedVals.forEach(val => {
        const option = document.createElement('vscode-option');
        option.value = val;
        option.textContent = val;
        combo.appendChild(option);
    });
    return combo;
}
export function setupTextareaF4Handler(textarea, combo) {
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'F4') {
            e.preventDefault();
            // Pre-select current value if present
            let found = false;
            for (let i = 0; i < combo.options.length; i++) {
                if (combo.options[i].value === textarea.value) {
                    combo.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) combo.selectedIndex = -1;
            combo.style.display = '';
            combo.focus();
            textarea.style.display = 'none';
        }
    });
}

export function setupComboboxHandlers(textarea, combo) {
    // Combo select handler
    combo.addEventListener('change', () => {
        textarea.value = combo.value;
        combo.style.display = 'none';
        textarea.style.display = '';
        textarea.focus();
    });

    // Combo cancel handler (Escape)
    combo.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            combo.style.display = 'none';
            textarea.style.display = '';
            textarea.focus();
        }
    });
}