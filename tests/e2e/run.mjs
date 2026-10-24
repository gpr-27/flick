// npm run e2e [-- playwright args]    start the stack, run the Playwright tests, tear down
// npm run e2e:screenshots             start the stack, take the README screenshots, tear down
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStack } from './stack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const screenshots = args[0] === '--screenshots';
const [command, commandArgs] = screenshots
  ? [join(root, 'node_modules', '.bin', 'tsx'), ['tests/e2e/screenshots.ts']]
  : [
      join(root, 'node_modules', '.bin', 'playwright'),
      ['test', '--config', 'tests/e2e/playwright.config.ts', ...args],
    ];

const stack = await startStack();
let code;
try {
  // `--serve`: keep the stack up for poking at by hand, e.g. open <web url>/?as=alice. Ctrl-C stops it.
  if (args[0] === '--serve') await new Promise(() => undefined);
  code = await new Promise((done) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, E2E_WEB_URL: stack.webUrl, E2E_API_URL: stack.apiUrl },
    });
    child.once('exit', (status) => {
      done(status ?? 1);
    });
  });
} finally {
  await stack.stop();
}
process.exit(code);
