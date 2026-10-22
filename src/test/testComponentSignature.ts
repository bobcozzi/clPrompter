import * as assert from 'assert';
import { getCmdHelpSQLSrc } from '../components/cmdHelp/cmdHelpSqlSource';
import { normalizeComponentSqlForSignature } from '../components/signatureUtils';

function run(): void {
    const tempLibSql = normalizeComponentSqlForSignature(getCmdHelpSQLSrc('*TEMPLIB', 5), '*TEMPLIB');
    const configuredLibSql = normalizeComponentSqlForSignature(getCmdHelpSQLSrc('ILEDITOR', 5), 'ILEDITOR');
    const customLibSql = normalizeComponentSqlForSignature(getCmdHelpSQLSrc('MYLIB', 5), 'MYLIB');

    const hostFunctionsText = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'hostFunctions.ts'), 'utf8');
    assert.match(hostFunctionsText, /readonly currentVersion = 3;/,
        'OBJ_ATTR component version must be bumped to trigger update installs');
    assert.match(hostFunctionsText, /readonly PGM_NAME = 'OBJ_ATTR';[\s\S]*readonly currentVersion = 3;/,
        'OBJ_ATTR checker must have its currentVersion bumped in the same object block');

    assert.strictEqual(tempLibSql, configuredLibSql,
        'component signature must not change when the same component is installed in a different temp library');
    assert.strictEqual(configuredLibSql, customLibSql,
        'component signature must not vary by installation library name');

    console.log('testComponentSignature: all assertions passed');
}

run();
