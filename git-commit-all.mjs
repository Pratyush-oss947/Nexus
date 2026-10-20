import git from 'isomorphic-git';
import fs from 'fs';
import path from 'path';

const projectDir = 'C:\\Users\\Home\\.gemini\\antigravity\\scratch\\nexus-ai';

async function main() {
  console.log('Initializing git repository...');
  await git.init({ fs, dir: projectDir, defaultBranch: 'main' });

  console.log('Scanning files and checking git status...');
  const statusMatrix = await git.statusMatrix({
    fs,
    dir: projectDir,
  });

  const filesToAdd = [];
  for (const [filepath, head, worktree, stage] of statusMatrix) {
    if (filepath === '.env' || filepath.startsWith('.env.')) {
      console.warn(`WARNING: Skipping secret file ${filepath}`);
      continue;
    }
    // If modified, untracked, or added
    if (worktree !== 0 && (head === 0 || worktree === 2)) {
      filesToAdd.push(filepath);
    }
  }

  console.log(`Found ${filesToAdd.length} files to stage.`);
  for (const file of filesToAdd) {
    await git.add({ fs, dir: projectDir, filepath: file });
  }

  console.log('Committing staged files...');
  const sha = await git.commit({
    fs,
    dir: projectDir,
    author: {
      name: 'NEXUS Agent',
      email: 'nexus@ai.local',
    },
    message: 'feat: update ElevenLabs API key, voice integration, task engine, and custom branding icon',
  });

  console.log(`Successfully committed! Commit SHA: ${sha}`);

  const commits = await git.log({ fs, dir: projectDir, depth: 5 });
  console.log('Recent commits:');
  for (const c of commits) {
    console.log(`- [${c.oid.slice(0, 7)}] ${c.commit.message.trim()} (${c.commit.author.name})`);
  }

  // Safety check: verify .env is NOT in the tree
  const tree = await git.listFiles({ fs, dir: projectDir, ref: 'HEAD' });
  const hasSecret = tree.some(f => f === '.env' || f.includes('.env'));
  console.log(`Safety check: .env in git tree? ${hasSecret ? 'FAILED! .env found!' : 'PASSED! .env is not in git.'}`);
}

main().catch(err => {
  console.error('Git operation failed:', err);
  process.exit(1);
});
