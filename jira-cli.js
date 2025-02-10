import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const EMAIL = process.env.JIRA_EMAIL;
const API_TOKEN = process.env.JIRA_API_TOKEN;

const teams = ['S12P11E101', 'S12P11E102', 'S12P11E103', 'S12P11E104', 'S12P11E105', 'S12P11E106', 'S12P11E107'];

const auth = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

async function getUpdatedIssues(projectKey) {
    const today = new Date().toISOString().split('T')[0];
    const jql = encodeURIComponent(`project = ${projectKey} AND updated >= "${today}" ORDER BY updated DESC`);
    
    try {
        const response = await fetch(
            `https://${JIRA_DOMAIN}/rest/api/3/search?jql=${jql}&fields=key,summary,status,updated`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`API 응답 에러 (${response.status}): ${errorData}`);
        }

        const data = await response.json();
        return data.issues.map(issue => ({
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            updated: new Date(issue.fields.updated).toLocaleString()
        }));
    } catch (error) {
        console.error(`Error fetching issues for ${projectKey}:`, error.message);
        return [];
    }
}

async function main() {
    let output = `# ${new Date().toLocaleDateString()} 작업 내역\n`;
    
    for (const team of teams) {
        const issues = await getUpdatedIssues(team);
        if (issues.length > 0) {
            output += `\n## ${team}\n`;
            issues.forEach(issue => {
                output += `- ${issue.summary}\n`;
            });
        }
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const fileName = `일일보고서용-Jira-${today}.md`;
        
        await fs.writeFile(fileName, output, 'utf-8');
        console.log(`결과가 ${fileName}에 저장되었습니다.`);
    } catch (error) {
        console.error('파일 저장 중 오류 발생:', error);
    }
}

main();
