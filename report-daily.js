import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

async function combineReports() {
    try {
        // 먼저 각각의 스크립트 실행
        await Promise.all([
            execAsync('node gitlab-cli.js'),
            execAsync('node jira-cli.js')
        ]);

        const today = new Date().toISOString().split('T')[0];
        const gitReportPath = `./daily-git/일일보고서용-Git-${today}.md`;
        const jiraReportPath = `./daily-jira/일일보고서용-Jira-${today}.md`;

        // 각 파일 읽기
        const [gitContent, jiraContent] = await Promise.all([
            fs.readFile(gitReportPath, 'utf-8'),
            fs.readFile(jiraReportPath, 'utf-8')
        ]);

        // 팀별로 데이터 정리
        const teams = ['E201', 'E202', 'E203', 'E204', 'E205', 'E206', 'E207'];
        let combinedContent = '';

        for (const team of teams) {
            const teamPattern = new RegExp(`## .*${team}[\\s\\S]*?(?=\\n## |$)`, 'g');
            
            const jiraMatch = jiraContent.match(teamPattern);
            const gitMatch = gitContent.match(teamPattern);

            if (jiraMatch || gitMatch) {
                combinedContent += `\n## ${team}팀\n\n`;
                
                if (jiraMatch) {
                    const jiraSection = jiraMatch[0].replace(/^## .*\n/, '');
                    combinedContent += `### Jira 완료된 이슈\n${jiraSection.trim()}\n\n`;
                }
                
                if (gitMatch) {
                    const gitSection = gitMatch[0]
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