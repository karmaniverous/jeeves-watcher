import { execSync } from 'child_process';
const o = { cwd: 'D:/repos/karmaniverous/jeeves-watcher', encoding: 'utf8', stdio: 'inherit' };
execSync('git add -A', o);
execSync('git commit -m "chore: remove cloud sync workflow"', o);
execSync('git push', o);
