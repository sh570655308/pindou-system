const { execSync, cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, statSync } = require('fs');
const path = require('path');
const https = require('https');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const RELEASE_DIR = path.join(__dirname, '..', 'release');
const ROOT_DIR = path.join(__dirname, '..');
const NODE_VERSION = '20.11.0';
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;

console.log('=== 拼豆库存管理系统 - 打包脚本 ===\n');

// 清理旧的发布目录
if (existsSync(RELEASE_DIR)) {
  console.log('清理旧的发布目录...');
  rmSync(RELEASE_DIR, { recursive: true });
}

// 创建发布目录
mkdirSync(RELEASE_DIR, { recursive: true });

// 1. 构建前端
console.log('\n[1/6] 构建前端...');
try {
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  // 复制构建产物到 server/public
  const buildSrc = path.join(ROOT_DIR, 'client', 'build');
  const publicDest = path.join(ROOT_DIR, 'server', 'public');
  if (existsSync(publicDest)) rmSync(publicDest, { recursive: true });
  cpSync(buildSrc, publicDest, { recursive: true });
  console.log('前端构建完成');
} catch (error) {
  console.error('前端构建失败');
  process.exit(1);
}

// 2. 安装生产依赖到 release 目录
console.log('\n[2/6] 安装生产依赖...');
mkdirSync(path.join(RELEASE_DIR, 'app'), { recursive: true });

// 复制 package.json 和 package-lock.json
cpSync(path.join(ROOT_DIR, 'package.json'), path.join(RELEASE_DIR, 'app', 'package.json'));
if (existsSync(path.join(ROOT_DIR, 'package-lock.json'))) {
  cpSync(path.join(ROOT_DIR, 'package-lock.json'), path.join(RELEASE_DIR, 'app', 'package-lock.json'));
}

// 安装生产依赖
execSync('npm install --production', { cwd: path.join(RELEASE_DIR, 'app'), stdio: 'inherit' });

// 复制 server 目录
console.log('\n[3/6] 复制后端代码...');
cpSync(path.join(ROOT_DIR, 'server'), path.join(RELEASE_DIR, 'app', 'server'), { recursive: true });

// 3. 下载便携版 Node.js
console.log('\n[4/6] 下载便携版 Node.js...');
const nodeZipPath = path.join(RELEASE_DIR, 'node.zip');
const nodeExtractPath = path.join(RELEASE_DIR, 'node-temp');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', reject);
  });
}

async function downloadNode() {
  try {
    await downloadFile(NODE_URL, nodeZipPath);
    console.log('Node.js 下载完成');
  } catch (error) {
    console.error('Node.js 下载失败:', error.message);
    console.log('请手动下载 Node.js 便携版并解压到 release/node 目录');
    process.exit(1);
  }
}

downloadNode().then(() => {
  // 解压 Node.js
  console.log('解压 Node.js...');
  mkdirSync(nodeExtractPath, { recursive: true });
  execSync(`powershell -command "Expand-Archive -Path '${nodeZipPath}' -DestinationPath '${nodeExtractPath}' -Force"`, { stdio: 'inherit' });

  // 重命名目录
  const extractedDir = path.join(nodeExtractPath, `node-v${NODE_VERSION}-win-x64`);
  if (existsSync(extractedDir)) {
    cpSync(extractedDir, path.join(RELEASE_DIR, 'node'), { recursive: true });
    rmSync(nodeExtractPath, { recursive: true });
    rmSync(nodeZipPath);
  }

  // 4. 创建必要的目录结构
  console.log('\n[5/6] 创建目录结构...');
  mkdirSync(path.join(RELEASE_DIR, 'app', 'data', 'database'), { recursive: true });

  // 5. 创建启动脚本
  console.log('\n[6/6] 创建启动脚本...');

  const startBat = `@echo off
chcp 65001 >nul 2>&1
cls
echo.
echo  ================================================================
echo    拼豆库存管理系统
echo  ================================================================
echo.
echo   访问地址: http://localhost:5000
echo   默认账号: admin / admin123
echo.
echo   启动服务中...
echo.

cd /d "%~dp0app"
"..\\node\\node.exe" server/index.js

echo.
echo  ================================================================
echo    服务已停止
echo  ================================================================
pause
`;
  writeFileSync(path.join(RELEASE_DIR, 'start.bat'), startBat);

  // 6. 复制配置文件和文档
  if (existsSync(path.join(ROOT_DIR, 'env.example'))) {
    cpSync(path.join(ROOT_DIR, 'env.example'), path.join(RELEASE_DIR, 'app', '.env.example'));
  }

  const docsToCopy = ['README.md', 'USAGE.md', 'mard280色号.txt'];
  docsToCopy.forEach(doc => {
    const src = path.join(ROOT_DIR, doc);
    if (existsSync(src)) {
      cpSync(src, path.join(RELEASE_DIR, doc));
    }
  });

  // 7. 删除不必要的文件以减小体积
  console.log('\n清理不必要的文件...');

  // 删除 app/node_modules 中的不必要的文件
  const nodeModulesPath = path.join(RELEASE_DIR, 'app', 'node_modules');
  if (existsSync(nodeModulesPath)) {
    const modulesToClean = readdirSync(nodeModulesPath);
    modulesToClean.forEach(mod => {
      const modPath = path.join(nodeModulesPath, mod);
      try {
        const stat = statSync(modPath);
        if (stat.isDirectory()) {
          // 删除 .github, test, tests, examples, docs 等目录
          const dirsToRemove = ['.github', 'test', 'tests', 'examples', 'docs', 'example', 'benchmark'];
          dirsToRemove.forEach(dir => {
            const dirPath = path.join(modPath, dir);
            if (existsSync(dirPath)) {
              rmSync(dirPath, { recursive: true });
            }
          });
          // 删除 *.md, *.ts, *.map 等文件
          const files = readdirSync(modPath);
          files.forEach(file => {
            if (file.endsWith('.md') || file.endsWith('.ts') || file.endsWith('.map') || file.endsWith('.markdown')) {
              const filePath = path.join(modPath, file);
              if (statSync(filePath).isFile()) {
                rmSync(filePath);
              }
            }
          });
        }
      } catch (e) {}
    });
  }

  console.log('\n=== 打包完成 ===');
  console.log(`\n发布包已生成在: ${RELEASE_DIR}`);
  console.log('\n目录结构:');
  console.log('  release/');
  console.log('  ├── node/          (便携版 Node.js)');
  console.log('  ├── app/');
  console.log('  │   ├── server/    (后端代码)');
  console.log('  │   ├── node_modules/');
  console.log('  │   └── data/      (数据库目录)');
  console.log('  ├── start.bat      (启动脚本)');
  console.log('  └── 说明文档');
  console.log('\n用户只需双击 start.bat 即可启动服务');
});
