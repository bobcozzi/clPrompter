

export const TOOLTIP_SETTINGS = {
    focusDuration: 3000, // Default 3 seconds for focus tooltips
    errorDuration: 6000, // 6 seconds for error tooltips
    hoverDuration: 2000, // 2 seconds for hover tooltips
    highZIndex: 15000 // High z-index to stay above dropdowns
};

export function getTooltipSettings() {
    return TOOLTIP_SETTINGS;
}

// ✅ New function for showing success tooltip only on specific events
export function showSuccessTooltipIfValid(input) {
    const fromValue = input.getAttribute('data-range-from');
    const toValue = input.getAttribute('data-range-to');

    if (!fromValue || !toValue) return;

    const value = input.value.trim();

    if (value && !value.startsWith('*')) {
        const numValue = parseInt(value, 10);
        const fromNum = parseInt(fromValue, 10);
        const toNum = parseInt(toValue, 10);

        if (!isNaN(numValue) && !isNaN(fromNum) && !isNaN(toNum)) {
            if (numValue >= fromNum && numValue <= toNum) {
                showRangeTooltip(input, `✅ Valid: ${value} (range: ${fromValue}-${toValue})`, 'success', 1500);
            }
        }
    }
}

// ✅ Enhanced tooltip management functions
let currentTooltip = null;
let hideTimeout = null;

export function showRangeTooltip(input, message, type = 'info', duration = null) {
    // Clear any existing hide timeout
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    // Remove existing tooltip
    hideRangeTooltip();

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'range-tooltip';
    tooltip.textContent = message;

    // ✅ Enhanced type-specific styling with higher z-index
    if (type === 'error') {
        tooltip.style.background = '#d32f2f';
        tooltip.style.borderColor = '#b71c1c';
        tooltip.style.color = '#ffffff';
        tooltip.style.fontWeight = 'bold';
        tooltip.style.zIndex = TOOLTIP_SETTINGS.highZIndex;
    } else if (type === 'info') {
        tooltip.style.background = '#1976d2';
        tooltip.style.borderColor = '#1565c0';
        tooltip.style.color = '#ffffff';
        tooltip.style.zIndex = TOOLTIP_SETTINGS.highZIndex; // ✅ Higher than dropdown
    } else if (type === 'hint') {
        tooltip.style.background = '#616161';
        tooltip.style.borderColor = '#424242';
        tooltip.style.color = '#ffffff';
        tooltip.style.zIndex = TOOLTIP_SETTINGS.highZIndex;
    }

    document.body.appendChild(tooltip);

    // Position tooltip
    const rect = input.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // ✅ Better positioning logic
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    let top = rect.bottom + 8;

    // Keep tooltip within viewport
    const margin = 10;
    if (left < margin) left = margin;
    if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
    }

    // If tooltip would go below viewport, show above input
    if (top + tooltipRect.height > window.innerHeight - margin) {
        top = rect.top - tooltipRect.height - 8;

        // Flip arrow direction
        tooltip.classList.add('tooltip-above');
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    // Show tooltip with animation
    setTimeout(() => {
        tooltip.classList.add('show');
    }, 10);

    currentTooltip = tooltip;

    // ✅ Use configurable duration
    const hideDelay = duration || (
        type === 'error' ? TOOLTIP_SETTINGS.errorDuration :
            type === 'info' ? TOOLTIP_SETTINGS.focusDuration :
                TOOLTIP_SETTINGS.hoverDuration
    );

    hideTimeout = setTimeout(() => {
        hideRangeTooltip();
    }, hideDelay);
}

export function hideRangeTooltip() {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    if (currentTooltip) {
        currentTooltip.classList.remove('show');
        setTimeout(() => {
            if (currentTooltip && currentTooltip.parentNode) {
                currentTooltip.parentNode.removeChild(currentTooltip);
            }
            currentTooltip = null;
        }, 200);
    }
}

