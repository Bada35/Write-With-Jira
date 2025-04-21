import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const GITLAB_DOMAIN = process.env.GITLAB_DOMAIN || 'gitlab.com';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

// 명령줄 인수 확인
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('사용법: node commit-info.js <저장소_경로> <커밋_ID>');
  console.error('예시: node commit-info.js /s12-final/S12P31E201 a1b2c3d4e5f6');
  process.exit(1);
}

const REPO_PATH = 's12-final/S12P31E201'; // 예: args[0]
const COMMIT_ID = '69660396'; // 예: args[1]

async function getProjectId(repoPath) {
  // 앞에 슬래시(/)가 있으면 제거
  const path = repoPath.startsWith('/') ? repoPath.substring(1) : repoPath;
  
  // 경로 인코딩
  const encodedPath = encodeURIComponent(path);
  
  console.log(`프로젝트 ID 조회: ${path} (인코딩: ${encodedPath})`);
  
  try {
    const response = await fetch(
      `https://${GITLAB_DOMAIN}/api/v4/projects/${encodedPath}`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`프로젝트 ID 조회 오류 (${response.status}): ${errorText}`);
      throw new Error(`API 응답 에러 (${response.status})`);
    }

    const data = await response.json();
    console.log(`프로젝트 ID 조회 성공: ${path} -> ${data.id}`);
    return data.id;
  } catch (error) {
    console.error(`프로젝트 ID 조회 오류: ${path}:`, error.message);
    throw error;
  }
}

async function getCommitInfo(projectId, commitId) {
  console.log(`커밋 정보 조회: 프로젝트 ${projectId}, 커밋 ${commitId}`);
  
  try {
    // 1. 커밋 기본 정보 조회
    const commitResponse = await fetch(
      `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits/${commitId}`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
          'Accept': 'application/json'
        }
      }
    );

    if (!commitResponse.ok) {
      const errorText = await commitResponse.text();
      console.error(`커밋 정보 조회 오류 (${commitResponse.status}): ${errorText}`);
      throw new Error(`API 응답 에러 (${commitResponse.status})`);
    }

    const commitData = await commitResponse.json();
    
    // 2. 커밋 상세 정보 조회 (변경 파일 목록 등)
    const commitDetailResponse = await fetch(
      `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits/${commitId}/diff`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
          'Accept': 'application/json'
        }
      }
    );

    if (!commitDetailResponse.ok) {
      console.error(`커밋 상세 정보 조회 오류 (${commitDetailResponse.status})`);
    }

    const commitDiff = await commitDetailResponse.json();
    
    // 3. 커밋의 브랜치 정보 조회
    const branchResponse = await fetch(
      `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits/${commitId}/refs?type=branch`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
          'Accept': 'application/json'
        }
      }
    );

    let branches = [];
    if (branchResponse.ok) {
      const branchesData = await branchResponse.json();
      branches = branchesData.map(ref => ref.name);
    } else {
      console.error(`브랜치 정보 조회 오류 (${branchResponse.status})`);
    }
    
    // 4. 결과 합치기
    return {
      basic: commitData,
      diff: commitDiff,
      branches: branches
    };
  } catch (error) {
    console.error(`커밋 정보 조회 중 오류:`, error.message);
    throw error;
  }
}

async function main() {
  try {
    // 프로젝트 ID 조회
    const projectId = await getProjectId(REPO_PATH);
    
    // 커밋 정보 조회
    const commitInfo = await getCommitInfo(projectId, COMMIT_ID);
    
    // 결과 출력
    console.log('\n========== 커밋 기본 정보 ==========');
    const basicInfo = commitInfo.basic;
    console.log(`커밋 ID: ${basicInfo.id}`);
    console.log(`단축 ID: ${basicInfo.short_id}`);
    console.log(`제목: ${basicInfo.title}`);
    console.log(`메시지: ${basicInfo.message}`);
    console.log(`작성자: ${basicInfo.author_name} <${basicInfo.author_email}>`);
    console.log(`작성일: ${new Date(basicInfo.created_at).toLocaleString()}`);
    console.log(`커밋 URL: ${basicInfo.web_url}`);
    console.log(`상태: ${basicInfo.status}`);
    
    console.log('\n========== 브랜치 정보 ==========');
    if (commitInfo.branches.length > 0) {
      console.log(`이 커밋이 포함된 브랜치: ${commitInfo.branches.join(', ')}`);
    } else {
      console.log('브랜치 정보가 없습니다.');
    }
    
    console.log('\n========== 변경된 파일 목록 ==========');
    if (commitInfo.diff.length > 0) {
      commitInfo.diff.forEach((file, index) => {
        console.log(`[${index + 1}] ${file.new_path} (${file.deleted_file ? '삭제됨' : file.new_file ? '추가됨' : '수정됨'})`);
        console.log(`   변경: +${file.diff.match(/^\+[^+]/gm)?.length || 0} 줄, -${file.diff.match(/^-[^-]/gm)?.length || 0} 줄`);
      });
    } else {
      console.log('변경된 파일이 없습니다.');
    }
    
    // 상세 정보 파일로 저장
    const detailOutput = JSON.stringify(commitInfo, null, 2);
    const fileName = `commit-detail-${COMMIT_ID}.json`;
    await fs.writeFile(fileName, detailOutput);
    console.log(`\n상세 정보가 ${fileName} 파일로 저장되었습니다.`);
    
  } catch (error) {
    console.error('오류 발생:', error);
    process.exit(1);
  }
}

main(); 