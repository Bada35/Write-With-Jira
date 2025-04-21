import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

// 환경 변수에서 팀 정보 및 저장소 형식 가져오기
const TEAMS = process.env.TEAM_IDS ? process.env.TEAM_IDS.split(',') : ['E201', 'E202', 'E203', 'E204', 'E205', 'E206', 'E207'];
const REPO_PREFIX = process.env.REPO_PREFIX || 'S12P31'; // 저장소 접두사 (예: S12P31E201의 'S12P31')
const REPO_PATH_PREFIX = process.env.REPO_PATH_PREFIX || '/s12-final/'; // 저장소 경로 접두사 (예: /s12-final/S12P31E201의 '/s12-final/')

// 보고서 파일 경로 및 이름 설정
const GIT_REPORT_DIR = process.env.GIT_REPORT_DIR || './daily-git';
const GIT_REPORT_FILENAME = process.env.GIT_REPORT_FILENAME || '일일보고서용-Git';
const JIRA_REPORT_DIR = process.env.JIRA_REPORT_DIR || './daily-jira';
const JIRA_REPORT_FILENAME = process.env.JIRA_REPORT_FILENAME || '일일보고서용-Jira';
const DAILY_REPORT_DIR = process.env.DAILY_REPORT_DIR || './daily-report';
const DAILY_REPORT_FILENAME = process.env.DAILY_REPORT_FILENAME || '일일보고서';

async function combineReports() {
    try {
        // 먼저 각각의 스크립트 실행
        await Promise.all([
            execAsync('node run-files/gitlab-cli.js'),
            execAsync('node run-files/jira-cli.js')
        ]);

        // 날짜 변수 설정 - 환경 변수로 지정된 날짜 또는 현재 날짜 사용
        const TARGET_DATE = process.env.TARGET_DATE; // 형식: YYYY-MM-DD
        const today = TARGET_DATE || new Date().toISOString().split('T')[0];
        console.log(`보고서 날짜: ${today}`);

        const gitReportPath = `${GIT_REPORT_DIR}/${GIT_REPORT_FILENAME}-${today}.md`;
        const jiraReportPath = `${JIRA_REPORT_DIR}/${JIRA_REPORT_FILENAME}-${today}.md`;

        // 각 파일 읽기
        const [gitContent, jiraContent] = await Promise.all([
            fs.readFile(gitReportPath, 'utf-8').catch(() => ''), // 파일이 없으면 빈 문자열 반환
            fs.readFile(jiraReportPath, 'utf-8').catch(() => '')
        ]);
        
        // Git 보고서에서 팀별 개발자 커밋 수 섹션 추출
        const teamCommitsPattern = /## 팀별 개발자 커밋 수[\s\S]*?(?=\n## |$)/g;
        const teamCommitsMatch = gitContent.match(teamCommitsPattern);
        const teamCommitsSection = teamCommitsMatch ? teamCommitsMatch[0] : '';

        // 팀별로 데이터 정리
        let combinedContent = '';
        
        // 팀별 개발자 커밋 수를 맨 위에 배치
        if (teamCommitsSection) {
            combinedContent += teamCommitsSection + '\n\n';
        }

        for (const team of TEAMS) {
            // Jira 이슈 검색
            const jiraTeamPattern = new RegExp(`## .*${team}[\\s\\S]*?(?=\\n## |$)`, 'g');
            const jiraMatch = jiraContent.match(jiraTeamPattern);
            
            // Git 저장소 경로 구성 (예: /s12-final/S12P31E201)
            const repoPathPattern = `${REPO_PATH_PREFIX}${REPO_PREFIX}${team}`;
            // Git 커밋 내역 검색 - 각 팀 저장소에 있는 상세 커밋 내역
            const gitTeamRepoPattern = new RegExp(`## .*${repoPathPattern.replace(/\//g, '\\/')}[\\s\\S]*?(?=\\n## |$)`, 'g');
            const gitMatch = gitContent.match(gitTeamRepoPattern);

            if (jiraMatch || gitMatch) {
                combinedContent += `\n## ${team}팀\n\n`;
                
                // Jira 이슈 추가
                if (jiraMatch) {
                    const jiraSection = jiraMatch[0].replace(/^## .*\n/, '');
                    combinedContent += `### Jira 완료된 이슈\n${jiraSection.trim()}\n\n`;
                }
                
                // Git 커밋 내역 추가
                if (gitMatch) {
                    let gitSection = gitMatch[0]
                        .replace(/^## .*\n/, '')
                        .trim();
                    
                    if (gitSection && gitSection.length > 2) {  // "- [" 같은 불완전한 라인 방지
                        combinedContent += `### Git 커밋 내역\n${gitSection}\n\n`;
                    }
                }
            }
        }

        // 결과 저장
        const combinedReportPath = path.join(DAILY_REPORT_DIR, `${DAILY_REPORT_FILENAME}-${today}.md`);

        await fs.mkdir(DAILY_REPORT_DIR, { recursive: true });
        await fs.writeFile(combinedReportPath, combinedContent.trim(), 'utf-8');

        console.log(`일일보고서가 생성되었습니다: ${combinedReportPath}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

combineReports(); 