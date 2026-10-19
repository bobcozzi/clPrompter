export function buildRestrictedValueErrorMessage(displayValues, options = {}) {
    const enteredValue = (options.enteredValue || '').trim();
    const parmName = (options.parmName || '').trim();
    const fieldLength = typeof options.fieldLength === 'number' ? options.fieldLength : undefined;
    if (enteredValue && parmName) {
        const padded = fieldLength && fieldLength > 0
            ? enteredValue.padEnd(fieldLength, ' ').slice(0, fieldLength)
            : enteredValue;
        // Mirror IBM i invalid restricted value text (CPD0133/CPD6238 family style).
        const template = options.invalidValueTemplate || `Value '{value}' for parameter {parmName} not allowed.`;
        return template
            .replace('{value}', padded)
            .replace('{parmName}', parmName);
    }
    const validValues = displayValues
        .filter(v => !v.startsWith('_RANGE_') && !v.startsWith('_REL_') && !v.startsWith('_DEPREL_'))
        .slice(0, 8);
    const valueDetail = validValues.length > 0
        ? ` Use one of: ${validValues.join(', ')}` + (displayValues.length > validValues.length ? '...' : '')
        : '';
    const nameHint = validValues.some(v => /^[A-Z0-9_]+$/.test(v) && !v.startsWith('_')) ? ' or a valid name' : '';
    const msgIdPrefix = options.msgId ? `${options.msgId}: ` : '';
    return `${msgIdPrefix}Value entered is not valid.${valueDetail}${nameHint}`;
}
export function buildDepErrorMessage(constraint, trueCount, options = {}) {
    const opSymbols = {
        GT: '>', GE: '>=', NL: '>=', LT: '<', LE: '<=', NG: '<=', EQ: '=', NE: '<>'
    };
    const valueMap = options.valueMap ?? {};
    const rawValueLookup = options.rawValueLookup ?? (() => '');
    const summarizeDepNames = () => {
        const names = [...new Set(constraint.depParms.map(dp => dp.kwd))];
        if (names.length === 0)
            return '';
        const display = names.length > 6 ? `${names.slice(0, 5).join(', ')}, ...` : names.join(', ');
        return display;
    };
    const isHexBlankLiteral = (val) => {
        if (!val)
            return false;
        const match = val.match(/^X'([0-9A-Fa-f]+)'$/);
        if (!match)
            return false;
        const hex = match[1].toUpperCase();
        if (hex.length === 0 || hex.length % 2 !== 0)
            return false;
        for (let i = 0; i < hex.length; i += 2) {
            if (hex.slice(i, i + 2) !== '40')
                return false;
        }
        return true;
    };
    const internalToDisplay = (kwd, internalVal) => {
        if (!internalVal)
            return '';
        if (isHexBlankLiteral(internalVal))
            return 'blank';
        const kwdMap = valueMap[kwd];
        if (kwdMap) {
            for (const [display, internal] of Object.entries(kwdMap)) {
                if (internal === internalVal)
                    return display;
            }
        }
        return internalVal;
    };
    const describeDepParm = (dp) => {
        if (dp.rel === 'SPCFD') {
            return `${dp.kwd} is specified`;
        }
        if (dp.cmpVal !== undefined) {
            if (isHexBlankLiteral(dp.cmpVal)) {
                if (dp.rel === 'EQ')
                    return `${dp.kwd} is blank`;
                if (dp.rel === 'NE')
                    return `${dp.kwd} cannot be blank`;
            }
            const sym = opSymbols[dp.rel] || dp.rel;
            const displayVal = internalToDisplay(dp.kwd, dp.cmpVal);
            return `${dp.kwd} ${sym} ${displayVal}`;
        }
        if (dp.cmpKwd) {
            const sym = opSymbols[dp.rel] || dp.rel;
            const cmpKwdRaw = rawValueLookup(dp.cmpKwd);
            return `${dp.kwd} ${sym} ${dp.cmpKwd}${cmpKwdRaw ? ` (${cmpKwdRaw})` : ''}`;
        }
        return `${dp.kwd} must be specified`;
    };
    const findReciprocalBlankPairMessage = () => {
        if (!constraint.ctlKwd || constraint.depParms.length !== 1)
            return null;
        const dp = constraint.depParms[0];
        if (!dp.cmpVal)
            return null;
        if (!isHexBlankLiteral(constraint.cmpVal) || !isHexBlankLiteral(dp.cmpVal))
            return null;
        if (!((constraint.ctlKwdRel === 'EQ' && dp.rel === 'NE') || (constraint.ctlKwdRel === 'NE' && dp.rel === 'EQ'))) {
            return null;
        }
        return `${constraint.ctlKwd} or ${dp.kwd} are required but not both.`;
    };
    const kwds = [...new Set(constraint.depParms.map(dp => dp.kwd))];
    const kwdList = kwds.join(', ');
    const reciprocalBlankPairMessage = findReciprocalBlankPairMessage();
    if (reciprocalBlankPairMessage) {
        return reciprocalBlankPairMessage;
    }
    const total = constraint.depParms.length;
    let require = '';
    switch (constraint.nbrTrueRel) {
        case 'GT':
            require = `at least ${constraint.nbrTrue + 1}`;
            break;
        case 'GE':
            require = `at least ${constraint.nbrTrue}`;
            break;
        case 'EQ':
            require = `exactly ${constraint.nbrTrue}`;
            break;
        case 'LE':
            require = `at most ${constraint.nbrTrue}`;
            break;
        case 'LT':
            require = `less than ${constraint.nbrTrue}`;
            break;
        case 'NE':
            if (constraint.nbrTrue === 0) {
                require = 'at least one';
            }
            else if (constraint.nbrTrue === total) {
                require = 'none';
            }
            else {
                require = `a count other than ${constraint.nbrTrue}`;
            }
            break;
        default: require = String(constraint.nbrTrue);
    }
    const cmpKwdEntry = constraint.depParms.find(dp => dp.cmpKwd);
    if (constraint.ctlKwdRel === 'ALWAYS' && cmpKwdEntry && constraint.nbrTrueRel === 'GT' && constraint.nbrTrue === 0) {
        return describeDepParm(cmpKwdEntry);
    }
    if (constraint.ctlKwdRel === 'ALWAYS' &&
        constraint.nbrTrueRel === 'EQ' &&
        constraint.nbrTrue === 1 &&
        constraint.depParms.length === 2 &&
        constraint.depParms.every(dp => dp.rel === 'SPCFD')) {
        return `${constraint.depParms[0].kwd} or ${constraint.depParms[1].kwd} are required but not both.`;
    }
    if (constraint.ctlKwdRel === 'ALWAYS' &&
        constraint.nbrTrueRel === 'GT' &&
        constraint.nbrTrue === 0 &&
        constraint.depParms.length === 2 &&
        constraint.depParms.every(dp => dp.rel === 'SPCFD')) {
        return `At least one of ${constraint.depParms[0].kwd} or ${constraint.depParms[1].kwd} is required.`;
    }
    const blankEq = constraint.depParms.find(dp => dp.rel === 'EQ' && isHexBlankLiteral(dp.cmpVal));
    const notBlankNe = constraint.depParms.find(dp => dp.rel === 'NE' && isHexBlankLiteral(dp.cmpVal));
    if (constraint.ctlKwdRel === 'ALWAYS' && blankEq && notBlankNe) {
        return `${blankEq.kwd} is blank, ${notBlankNe.kwd} cannot be blank.`;
    }
    if (constraint.ctlKwd) {
        const ctlOp = opSymbols[constraint.ctlKwdRel] || constraint.ctlKwdRel;
        const ctlCmpDisplay = (() => {
            if (!constraint.cmpVal)
                return rawValueLookup(constraint.ctlKwd) || constraint.ctlKwd;
            return internalToDisplay(constraint.ctlKwd, constraint.cmpVal);
        })();
        const ctlCmpIsBlank = isHexBlankLiteral(constraint.cmpVal);
        const ctlCondStr = constraint.ctlKwdRel === 'SPCFD'
            ? `${constraint.ctlKwd} is specified`
            : ctlCmpIsBlank && constraint.ctlKwdRel === 'EQ'
                ? `${constraint.ctlKwd} is blank`
                : ctlCmpIsBlank && constraint.ctlKwdRel === 'NE'
                    ? `${constraint.ctlKwd} is not blank`
                    : `${constraint.ctlKwd} ${ctlOp} ${ctlCmpDisplay}`;
        if (constraint.nbrTrueRel === 'EQ' && constraint.nbrTrue === total) {
            const conditions = constraint.depParms.map(dp => describeDepParm(dp)).join(' and ');
            return `When ${ctlCondStr}: ${conditions}`;
        }
        if (constraint.nbrTrueRel === 'GT' && constraint.nbrTrue === 0) {
            const conditions = constraint.depParms.map(dp => describeDepParm(dp)).join(' or ');
            return `When ${ctlCondStr}: ${conditions}`;
        }
    }
    const depNames = summarizeDepNames();
    if (depNames && constraint.nbrTrueRel === 'GE' && constraint.nbrTrue === 1 && total > 1) {
        return `At least one of ${depNames} is required.`;
    }
    if (depNames && constraint.nbrTrueRel === 'GT' && constraint.nbrTrue === 0 && total > 1) {
        return `At least one of ${depNames} is required.`;
    }
    if (depNames && constraint.nbrTrueRel === 'EQ' && constraint.nbrTrue === 1 && total > 1) {
        return `Exactly one of ${depNames} must be specified.`;
    }
    return `Dependency constraint violated (${constraint.msgId || kwdList}): ${require} of ${total} conditions must hold`;
}
//# sourceMappingURL=depDiagnostics.js.map