import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const EMAIL = process.env.JIRA_EMAIL;
const API_TOKEN = process.env.JIRA_API_TOKEN;

const auth = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

async function getIssueDetails(issueKey) {
    try {
        const response = await fetch(
            `https://${JIRA_DOMAIN}/rest/api/3/issue/${issueKey}`,
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
        
        // JSON 파일로 저장
        await fs.writeFile(
            `issue-${issueKey}.json`, 
            JSON.stringify(data, null, 2), 
            'utf-8'
        );
        
        console.log(`이슈 정보가 issue-${issueKey}.json 파일에 저장되었습니다.`);
        
        // 주요 필드들 콘솔에 출력
        console.log('\n주요 필드 정보:');
        console.log('이슈 키:', data.key);
        console.log('제목:', data.fields.summary);
        console.log('상태:', data.fields.status.name);
        console.log('담당자:', data.fields.assignee?.displayName || '미배정');
        console.log('생성일:', new Date(data.fields.created).toLocaleString());
        console.log('수정일:', new Date(data.fields.updated).toLocaleString());
        
    } catch (error) {
        console.error('에러 발생:', error.message);
    }
}

// S12P11E101-58 이슈 정보 가져오기
getIssueDetails('S12P11E101-58'); 