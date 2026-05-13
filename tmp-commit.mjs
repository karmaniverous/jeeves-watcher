import { execSync } from 'child_process';
const o = { cwd: 'D:/repos/karmaniverous/jeeves-watcher', encoding: 'utf8', stdio: 'inherit' };
execSync('git add -A', o);
execSync('git commit -m "fix: address review feedback — remove temp script, tslib external, gemini dimensions"', o);
execSync('git push', o);
