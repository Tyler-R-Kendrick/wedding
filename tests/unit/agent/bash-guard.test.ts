import { describe, expect, it } from 'vitest';
import { checkCommand } from '../../../scripts/agent/bash-guard.mjs';

describe('the agent Bash guard', () => {
  it('refuses full-command-line process matching, which matches the calling shell', () => {
    for (const cmd of ['until ! pgrep -f "npm ci" >/dev/null; do sleep 3; done', 'pkill -f "next dev"', 'pgrep -af next-server', 'killall node']) {
      expect(checkCommand(cmd), cmd).toMatch(/own shell/);
    }
  });

  it('refuses an unbounded wait loop and allows one wrapped in timeout', () => {
    expect(checkCommand('until grep -q done log; do sleep 10; done')).toMatch(/timeout/);
    expect(checkCommand('while true; do curl -s x; sleep 60; done')).toMatch(/timeout/);
    expect(checkCommand("timeout 300 bash -c 'until curl -fsS localhost:3000; do sleep 2; done'")).toBeNull();
    expect(checkCommand('cd repo && timeout 2400 ./ci-wait.sh sha')).toBeNull();
  });

  it('refuses swap', () => {
    expect(checkCommand('fallocate -l 12G /var/tmp/swapfile && mkswap /var/tmp/swapfile && swapon /var/tmp/swapfile')).toMatch(/swap/);
  });

  it('reads commands, not text: heredoc bodies, quoted prose and search patterns pass', () => {
    const heredoc = ['cat > wait.sh <<' + "'EOF'", 'until ! pgrep -f "x"; do sleep 3; done', 'swapon /swap', 'EOF', 'chmod +x wait.sh'].join('\n');
    expect(checkCommand(heredoc)).toBeNull();
    expect(checkCommand('echo "never use pgrep -f here"')).toBeNull();
    expect(checkCommand('grep -rn "pkill -f" docs')).toBeNull();
    // …but the same tools in command position inside `bash -c` are still caught.
    expect(checkCommand("timeout 60 bash -c 'pkill -f next'")).toMatch(/own shell/);
  });

  it('lets ordinary commands through', () => {
    for (const cmd of ['npm run test:unit', 'ps -eo pid,comm,args', 'pgrep -x next-server', 'kill 1234', 'for f in a b; do echo $f; done', 'git log --oneline -5', 'grep -rn "sleep" src']) {
      expect(checkCommand(cmd), cmd).toBeNull();
    }
  });
});
