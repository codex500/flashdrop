const fs = require('fs');
let code = fs.readFileSync('src/hooks/useFlashDrop.ts', 'utf8');

// Replace specific one-liners
code = code.replace(/if \(!peer\) \{ console\.error\(`\[TX\] ❌ No peer found for \$\{transferId\}`\); return \}/g, 'if (!peer) return');
code = code.replace(/if \(activeDc\) \{ activeDc\.send\('__done__'\); console\.log\('\[ENGINE\] 📤 Sent __done__ to receiver'\) \}/g, "if (activeDc) activeDc.send('__done__')");
code = code.replace(/if \(isDone\) \{ console\.log\(`\[SEND\] ⏹ isDone=true, skipping chunk #\$\{msgId\}`\); return \}/g, 'if (isDone) return');
code = code.replace(/if \(!dc\) \{ console\.warn\(`\[SEND\] ⚠️ No available channel for chunk #\$\{msgId\} — will retry`\); return \}/g, 'if (!dc) return');

// Remove standalone console.log, console.warn, console.error lines
const lines = code.split('\n');
const newLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('console.log') || trimmed.startsWith('console.warn') || trimmed.startsWith('console.error')) {
        return false;
    }
    return true;
});

fs.writeFileSync('src/hooks/useFlashDrop.ts', newLines.join('\n'), 'utf8');
