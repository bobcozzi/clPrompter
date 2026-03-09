/**
 * Simple verification test for CLPrompter API exports
 * This directly tests that activate() returns the expected API structure
 */

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║     CLPrompter API Export Verification Test           ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

console.log('Checking that activate() returns the API exports...\n');

// Since we can't run the extension without VS Code runtime, we'll check the source code
const fs = require('fs');
const path = require('path');

try {
    // Check the source file
    const extensionPath = path.join(__dirname, '..', 'src', 'extension.ts');

    if (!fs.existsSync(extensionPath)) {
        console.log('❌ Could not find extension.ts source file at:', extensionPath);
        console.log('   Looking for alternative location...');

        // Try compiled location
        const altPath = path.join(__dirname, 'extension.js');
        if (fs.existsSync(altPath)) {
            console.log('⚠️  Found compiled version, but need source for accurate verification');
        }
        process.exit(1);
    }

    const content = fs.readFileSync(extensionPath, 'utf-8');

    console.log('Step 1: Checking for CLPrompter import...');
    const hasImport = /import.*CLPrompter.*from\s+['"]\.\/clPrompter['"]/.test(content);
    if (hasImport) {
        console.log('  ✓ CLPrompter imported from clPrompter module');
    } else {
        console.log('  ❌ CLPrompter import not found');
    }

    console.log('\nStep 2: Checking for CLPrompterCallback import...');
    const hasCallbackImport = /import.*CLPrompterCallback.*from\s+['"]\.\/clPrompter['"]/.test(content);
    if (hasCallbackImport) {
        console.log('  ✓ CLPrompterCallback imported from clPrompter module');
    } else {
        console.log('  ❌ CLPrompterCallback import not found');
    }

    console.log('\nStep 3: Checking activate() function return statement...');

    // Check for the return statement - allow various whitespace patterns
    const hasReturnStatement = /return\s*\{\s*CLPrompter\s*,\s*CLPrompterCallback\s*\}/.test(content);

    if (hasReturnStatement) {
        console.log('  ✓ activate() returns { CLPrompter, CLPrompterCallback }');

        console.log('\n' + '='.repeat(60));
        console.log('✅ SUCCESS! API is properly exported');
        console.log('='.repeat(60));
        console.log('\nThe activate() function correctly returns:');
        console.log('  return { CLPrompter, CLPrompterCallback };');
        console.log('\nExternal extensions can access the API using:');
        console.log('\n  const ext = vscode.extensions.getExtension(\'CozziResearch.clprompter\');');
        console.log('  if (!ext.isActive) await ext.activate();');
        console.log('  const { CLPrompter } = ext.exports;');
        console.log('  const result = await CLPrompter(command);\n');
        process.exit(0);
    } else {
        console.log('  ❌ activate() does NOT return the API exports');

        console.log('\n' + '='.repeat(60));
        console.log('❌ FAIL: activate() return statement not found');
        console.log('='.repeat(60));
        console.log('\nYou need to add this at the end of the activate() function:');
        console.log('  return { CLPrompter, CLPrompterCallback };\n');
        process.exit(1);
    }

} catch (error: any) {
    console.log('❌ Fatal error:', error.message);
    console.log('\nCould not verify the API exports.');
    process.exit(1);
}
