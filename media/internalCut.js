(() => {
    const installedMarkers = new WeakSet();
    const supportedInputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

    function isSupportedTarget(target) {
        if (!target || typeof target.tagName !== 'string') {
            return false;
        }

        const tagName = target.tagName.toLowerCase();
        if (tagName === 'textarea') {
            return true;
        }

        if (tagName !== 'input') {
            return false;
        }

        const inputType = String(target.type || '').toLowerCase();
        return supportedInputTypes.has(inputType);
    }

    function toSelectionStart(target) {
        return typeof target.selectionStart === 'number' ? target.selectionStart : 0;
    }

    function toSelectionEnd(target, selectionStart) {
        return typeof target.selectionEnd === 'number' ? target.selectionEnd : selectionStart;
    }

    function deleteSelection(target) {
        const selectionStart = toSelectionStart(target);
        const selectionEnd = toSelectionEnd(target, selectionStart);
        if (selectionStart === selectionEnd) {
            return false;
        }

        const nextValue = String(target.value || '').slice(0, selectionStart) + String(target.value || '').slice(selectionEnd);
        target.value = nextValue;

        if (typeof target.setSelectionRange === 'function') {
            try {
                target.setSelectionRange(selectionStart, selectionStart);
            } catch {
                // Some input types do not support selection ranges.
            }
        }

        target.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    window.clPrompterInstallInternalCutHandler = function clPrompterInstallInternalCutHandler(target) {
        if (!isSupportedTarget(target) || installedMarkers.has(target)) {
            return;
        }

        installedMarkers.add(target);
        target.addEventListener('cut', (event) => {
            if (deleteSelection(target)) {
                event.preventDefault();
            }
        });
    };
})();