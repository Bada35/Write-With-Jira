import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

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

        const gitReportPath = `./daily-git/일일보고서용-Git-${today}.md`;
        const jiraReportPath = `./daily-jira/일일보고서용-Jira-${today}.md`;

        // 각 파일 읽기
        const [gitContent, jiraContent] = await Promise.all([
            fs.readFile(gitReportPath, 'utf-8'),
            fs.readFile(jiraReportPath, 'utf-8')
        ]);
        
        // Git 보고서에서 팀별 개발자 커밋 수 섹션 추출
        const teamCommitsPattern = /## 팀별 개발자 커밋 수[\s\S]*?(?=\n## |$)/g;
        const teamCommitsMatch = gitContent.match(teamCommitsPattern);
        const teamCommitsSection = teamCommitsMatch ? teamCommitsMatch[0] : '';

        // 팀별로 데이터 정리
        const teams = ['E201', 'E202', 'E203', 'E204', 'E205', 'E206', 'E207'];
        let combinedContent = '';
        
        // 팀별 개발자 커밋 수를 맨 위에 배치
        if (teamCommitsSection) {
            combinedContent += teamCommitsSection + '\n\n';
        }

        for (const team of teams) {
            // Jira 이슈 검색
            const jiraTeamPattern = new RegExp(`## .*${team}[\\s\\S]*?(?=\\n## |$)`, 'g');
            const jiraMatch = jiraContent.match(jiraTeamPattern);
            
            // Git 커밋 내역 검색 - 각 팀 저장소에 있는 상세 커밋 내역
            const gitTeamRepoPattern = new RegExp(`## .*S12P31${team}[\\s\\S]*?(?=\\n## |$)`, 'g');
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
        const dailyReportDir = './daily-report';
        const combinedReportPath = path.join(dailyReportDir, `일일보고서-${today}.md`);

        await fs.mkdir(dailyReportDir, { recursive: true });
        await fs.writeFile(combinedReportPath, combinedContent.trim(), 'utf-8');

        console.log(`일일보고서가 생성되었습니다: ${combinedReportPath}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

combineReports(); 