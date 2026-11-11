#!/usr/bin/env node
// EasyEDA Std (macOS) 트랙패드 패치
//   - 두 손가락 스크롤: 부드러운 화면 이동 (가로/세로 동시, 손가락 이동량에 비례)
//   - 핀치 / Ctrl·Option·Cmd + 스크롤: 줌 (임계값을 낮춰 즉각 반응)
// 사용법:
//   node patch-easyeda.js            패치 적용 (EasyEDA를 먼저 종료)
//   node patch-easyeda.js --restore  원본 복구
//
// 설정값은 아래 CONFIG 에서 조절 후 다시 실행하면 됩니다.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CONFIG = {
  PAN_SPEED: 1.0,   // 이동 속도 배율 (1.0 = 손가락과 거의 1:1)
  ZOOM_THRESHOLD: 12, // 줌 1단계에 필요한 누적 휠 값 (작을수록 민감, 원래 100)
};

const APP = "/Applications/EasyEDA.app";
const EDITOR_DIR = path.join(APP, "Contents/Resources/editor");
const TARGET_FILES = ["js/editorSCH.min.js", "js/editorPCB.min.js"];
const MARK = "/*TRACKPAD_PATCH*/";

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const asar = (...args) => run("npx", ["--yes", "@electron/asar", ...args]);

function findAsar() {
  const f = fs.readdirSync(EDITOR_DIR).filter((n) => /^[\d.]+\.asar$/.test(n));
  if (f.length !== 1) throw new Error(`editor asar 를 하나로 특정할 수 없음: ${f}`);
  return path.join(EDITOR_DIR, f[0]);
}

function isRunning() {
  try {
    execFileSync("pgrep", ["-x", "EasyEDA"]);
    return true;
  } catch {
    return false;
  }
}

function patchSource(src, file) {
  if (src.includes(MARK)) return src; // 이미 패치됨

  // 1) 휠 핸들러 안에서 쓰이는 (축소된) 변수명 수집
  const m1 = src.match(/"TEXTAREA"!=e\.target\.tagName&&\(!(\w+)\|\|!(\w+)\.dragpanning\)/);
  const m2 = src.match(/var \w+=(\w+)\.getViewBox\(\),\w+=20\/(\w+)/);
  const m3 = src.match(/var (\w+)=(\w+)\("ZoomWay"\);void 0===\1&&\(\1="ScrollKey"\)/);
  // 함수 이름은 파일마다 다르므로, 휠 핸들러를 내용(TEXTAREA + dragpanning 검사)으로 식별
  const m4 = src.match(/function \w+\(e\)\{(?=if\("TEXTAREA"!=e\.target\.tagName&&\(!\w+\|\|!\w+\.dragpanning\))/);
  const m5 = src.match(/a=1===e\.deltaMode,o=100;/);
  if (!m1 || !m2 || !m3 || !m4 || !m5) {
    throw new Error(`${file}: 패치 위치를 찾지 못함 (EasyEDA 버전이 달라졌을 수 있음)`);
  }
  const [, W, J] = m1;
  const [, VB, UE] = m2;

  // 2) 줌 모드를 "CTRL + Scroll" 로 고정 (수식키 없이 스크롤 = 이동, 수식키 + 스크롤 = 줌)
  src = src.replace(m3[0], `var ${m3[1]}=${m3[2]}("ZoomWay");${m3[1]}="CTRL"`);

  // 3) 줌 임계값 낮춤 (핀치/수식키 + 픽셀 단위 휠)
  src = src.replace(
    m5[0],
    `a=1===e.deltaMode,o=(e.ctrlKey||e.altKey||e.metaKey)&&!a?${CONFIG.ZOOM_THRESHOLD}:100;`
  );

  // 4) 수식키 없는 픽셀 스크롤은 직접 처리: 부드러운 2축 이동
  // PCB 의 setViewBox 는 무거우므로, 휠 이벤트를 모아 프레임당 1회만 반영 (rAF 합치기)
  const inject =
    `${MARK}if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.deltaMode&&"TEXTAREA"!=e.target.tagName&&(!${W}||!${J}.dragpanning)){` +
    `e.preventDefault();` +
    `var __g=window.__tp||(window.__tp={x:0,y:0,p:0});__g.x+=e.deltaX;__g.y+=e.deltaY;` +
    `if(!__g.p){__g.p=1;requestAnimationFrame(function(){__g.p=0;` +
    `var __v=${VB}.getViewBox(),__s=document.getElementById("root"),__w=__s&&__s.getBoundingClientRect().width,` +
    `__f=(__w?__v[2]/__w:1/${UE})*${CONFIG.PAN_SPEED};` +
    `__v[0]+=__g.x*__f;__v[1]+=__g.y*__f;__g.x=__g.y=0;${VB}.setViewBox(__v)})}return}`;
  src = src.replace(m4[0], m4[0] + inject);
  return src;
}

function restore(asarPath) {
  const bak = asarPath + ".orig";
  if (!fs.existsSync(bak)) throw new Error("백업(.orig)이 없습니다.");
  fs.copyFileSync(bak, asarPath);
  console.log("원본으로 복구했습니다.");
}

function resign() {
  try {
    run("xattr", ["-cr", APP]);
    run("codesign", ["--force", "--deep", "-s", "-", APP]);
  } catch (e) {
    console.warn("재서명 실패(무시 가능):", e.message);
  }
}

function main() {
  if (!fs.existsSync(APP)) throw new Error(`${APP} 없음`);
  if (!process.argv.includes("--check") && isRunning()) throw new Error("EasyEDA 가 실행 중입니다. 먼저 종료하세요.");

  const asarPath = findAsar();
  if (process.argv.includes("--restore")) {
    restore(asarPath);
    resign();
    return;
  }

  const bak = asarPath + ".orig";
  if (process.argv.includes("--check")) {
    // 적용 없이 패치 가능 여부와 문법만 검사
    const w = fs.mkdtempSync(path.join(os.tmpdir(), "easyeda-check-"));
    asar("extract", fs.existsSync(bak) ? bak : asarPath, path.join(w, "e"));
    for (const rel of TARGET_FILES) {
      const out = path.join(w, "p-" + path.basename(rel));
      fs.writeFileSync(out, patchSource(fs.readFileSync(path.join(w, "e", rel), "utf8"), rel));
      run("node", ["--check", out]);
      console.log("OK:", rel);
    }
    fs.rmSync(w, { recursive: true, force: true });
    return;
  }
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(asarPath, bak);
    console.log("백업 생성:", bak);
  }

  // 항상 원본 백업에서 시작해 재실행해도 중복 패치되지 않게 함
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "easyeda-patch-"));
  const dir = path.join(work, "editor");
  asar("extract", bak, dir);

  for (const rel of TARGET_FILES) {
    const p = path.join(dir, rel);
    fs.writeFileSync(p, patchSource(fs.readFileSync(p, "utf8"), rel));
    console.log("패치:", rel);
  }

  const out = path.join(work, "new.asar");
  asar("pack", dir, out);
  fs.copyFileSync(out, asarPath);
  fs.rmSync(work, { recursive: true, force: true });

  resign();
  console.log("완료. EasyEDA 를 실행하세요. (되돌리기: node patch-easyeda.js --restore)");
}

try {
  main();
} catch (e) {
  console.error("오류:", e.message);
  process.exit(1);
}
