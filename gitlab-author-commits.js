import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const GITLAB_DOMAIN = process.env.GITLAB_DOMAIN || 'gitlab.com';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

// 팀 정보 구성
const teams = [];
for (let i = 1; i <= 7; i++) {
    const teamNum = String(i).padStart(2, '0');
    const repoKey = `TEAM_E2${teamNum}_REPO`;
    const membersKey = `TEAM_E2${teamNum}_MEMBERS`;
    
    if (process.env[repoKey] && process.env[membersKey]) {
        try {
            const members = JSON.parse(process.env[membersKey]);
            teams.push({
                repo: process.env[repoKey],
                members: members
            });
        } catch (error) {
            console.error(`팀 E2${teamNum} 멤버 정보 파싱 실패:`, error.message);
        }
    }
}

if (teams.length === 0) {
    console.error('팀 정보가 설정되지 않았습니다.');
    process.exit(1);
}

const headers = {
    'Authorization': `Bearer ${GITLAB_TOKEN}`,
    'Accept': 'application/json'
};

async function getProjectId(repoPath) {
    const encodedPath = encodeURIComponent(repoPath.substring(1));
    try {
        const response = await fetch(
            `https://${GITLAB_DOMAIN}/api/v4/projects/${encodedPath}`,
            { headers }
        );

        if (!response.ok) {
            throw new Error(`API 응답 에러 (${response.status}): ${await response.text()}`);
        }

        const data = await response.json();
        return data.id;
    } catch (error) {
        console.error(`Error fetching project ID for ${repoPath}:`, error.message);
        return null;
    }
}

async function getBranches(projectId) {
    try {
        const response = await fetch(
            `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/branches`,
            { headers }
        );

        if (!response.ok) {
            throw new Error(`API 응답 에러 (${response.status})`);
        }

        const branches = await response.json();
        return branches.map(branch => branch.name);
    } catch (error) {
        console.error(`Error fetching branches for project ${projectId}:`, error.message);
        return ['main', 'master', 'develop']; // 기본 브랜치들이라도 시도
    }
}

async function getTwoWeeksCommits(projectId, member) {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const sinceDate = twoWeeksAgo.toISOString().split('T')[0];
    
    let allCommits = [];
    const branches = await getBranches(projectId);
    
    for (const branch of branches) {
        let page = 1;
        const per_page = 100;
        let hasMorePages = true;
        
        while (hasMorePages) {
            try {
                const response = await fetch(
                    `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits?` + 
                    `since=${sinceDate}T00:00:00Z&` +
                    `ref_name=${encodeURIComponent(branch)}&` +
                    `page=${page}&per_page=${per_page}`,
                    { headers }
                );

                if (!response.ok) {
                    console.error(`API 응답 에러 (${response.status})`);
                    break;
                }

                const commits = await response.json();
                if (commits.length === 0) {
                    hasMorePages = false;
                    break;
                }
                
                // 커밋 작성자 정보로 필터링
                const filteredCommits = commits
                    .filter(commit => {
                        const authorId = commit.author_email?.split('@')[0] || '';
                        const isAuthorMatch = 
                            authorId === member.id.replace('@', '') ||
                            commit.author_name === member.name;
                        return isAuthorMatch && !commit.title.startsWith('Merge branch');
                    })
                    .map(commit => ({
                        title: commit.title,
                        author: commit.author_name,
                        created_at: new Date(commit.created_at).toLocaleString(),
                        web_url: commit.web_url,
                        branch: branch
                    }));
                
                allCommits = allCommits.concat(filteredCommits);
                
                if (commits.length < per_page) {
                    hasMorePages = false;
                    break;
                }
                page++;
                
            } catch (error) {
                console.error(`Error fetching commits for project ${projectId}, member ${member.id}, branch ${branch}:`, error.message);
                hasMorePages = false;
                break;
            }
        }
    }
    
    // 중복 제거 (URL과 작성자 기준)
    const uniqueCommits = Array.from(new Set(allCommits.map(c => c.web_url)))
        .map(url => allCommits.find(c => c.web_url === url))
        .filter(commit => commit !== undefined);
    
    return uniqueCommits;
}

async function main() {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const sinceDate = twoWeeksAgo.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    
    for (const team of teams) {
        if (team.members.length === 0) continue;
        
        console.log(`\n팀 ${team.repo} 커밋 내역 수집 중...`);
        let output = `# ${sinceDate} ~ ${today} 커밋 내역\n\n`;
        output += `## ${team.repo}\n\n`;
        
        const projectId = await getProjectId(team.repo);
        if (!projectId) continue;

        let hasCommits = false;
        let totalTeamCommits = 0;
        const memberCommits = [];
        
        // 각 팀원의 커밋 수집
        for (const member of team.members) {
            const displayName = member.name || member.id;
            console.log(`- ${displayName} (${member.id}) 커밋 확인 중...`);
            const commits = await getTwoWeeksCommits(projectId, member);
            
            if (commits.length > 0) {
                hasCommits = true;
                totalTeamCommits += commits.length;
                memberCommits.push({ 
                    member: displayName, 
                    id: member.id, 
                    count: commits.length,
                    commits: commits 
                });
            } else {
                memberCommits.push({ 
                    member: displayName, 
                    id: member.id, 
                    count: 0,
                    commits: [] 
                });
            }
        }
        
        // 커밋 수로 정렬
        memberCommits.sort((a, b) => b.count - a.count);
        
        // 요약 정보 출력
        output += `### 팀원별 커밋 수 요약\n\n`;
        output += `- 팀 전체 커밋 수: ${totalTeamCommits}개\n`;
        output += `- 팀원별 커밋 수:\n`;
        memberCommits.forEach(({ member, id, count }) => {
            output += `  - ${member} (${id}): ${count}개\n`;
        });
        output += `\n`;
        
        // 상세 커밋 내역
        output += `### 상세 커밋 내역\n\n`;
        for (const { member, id, count, commits } of memberCommits) {
            if (count > 0) {
                output += `#### ${member} (${id}) - ${count}개\n`;
                commits.forEach(commit => {
                    // output += `- ${commit.title}\n  - 시간: ${commit.created_at}\n  - 브랜치: ${commit.branch}\n  - URL: ${commit.web_url}\n`;
                    output += `- ${commit.title}\n`;
                });
                output += '\n';
            }
        }

        if (hasCommits) {
            try {
                const dirPath = './daily-git';
                const teamName = team.repo.split('/').pop();
                const fileName = `2주간보고서용-Git-${teamName}-${today}.md`;
                const filePath = `${dirPath}/${fileName}`;
                
                try {
                    await fs.access(dirPath);
                } catch {
                    await fs.mkdir(dirPath, { recursive: true });
                }
                
                await fs.writeFile(filePath, output, 'utf-8');
                console.log(`결과가 ${filePath}에 저장되었습니다.`);
            } catch (error) {
                console.error('파일 저장 중 오류 발생:', error);
            }
        }
    }
}

main(); 