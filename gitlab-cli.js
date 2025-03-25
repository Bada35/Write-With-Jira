import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const GITLAB_DOMAIN = process.env.GITLAB_DOMAIN || 'gitlab.com';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

const repositories = process.env.REPOSITORIES ? process.env.REPOSITORIES.split(',') : [];

async function getProjectId(repoPath) {
    const encodedPath = encodeURIComponent(repoPath.substring(1)); // 첫 '/' 제거하고 인코딩
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
            throw new Error(`API 응답 에러 (${response.status})`);
        }

        const data = await response.json();
        return data.id;
    } catch (error) {
        console.error(`Error fetching project ID for ${repoPath}:`, error.message);
        return null;
    }
}

async function getTodayCommits(projectId) {
    const today = new Date().toISOString().split('T')[0];
    try {
        const response = await fetch(
            `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits?since=${today}T00:00:00Z&all=true`,
            {
                headers: {
                    'PRIVATE-TOKEN': GITLAB_TOKEN,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`API 응답 에러 (${response.status})`);
        }

        const commits = await response.json();
        
        // Merge branch로 시작하는 커밋 필터링
        const filteredCommits = commits.filter(commit => !commit.title.startsWith('Merge branch'));
        
        // 각 커밋의 브랜치 정보 가져오기
        const commitsWithBranch = await Promise.all(
            filteredCommits.map(async (commit) => {
                const branchResponse = await fetch(
                    `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits/${commit.id}/refs?type=branch`,
                    {
                        headers: {
                            'PRIVATE-TOKEN': GITLAB_TOKEN,
                            'Accept': 'application/json'
                        }
                    }
                );
                
                if (!branchResponse.ok) {
                    return {
                        ...commit,
                        branches: ['unknown']
                    };
                }
                
                const refs = await branchResponse.json();
                const branches = refs.map(ref => ref.name);
                
                return {
                    title: commit.title,
                    author: commit.author_name,
                    created_at: new Date(commit.created_at).toLocaleString(),
                    branches: branches
                };
            })
        );

        return commitsWithBranch;
    } catch (error) {
        console.error(`Error fetching commits for project ${projectId}:`, error.message);
        return [];
    }
}

async function main() {
    let output = `# ${new Date().toLocaleDateString()} 커밋 내역\n\n`;
    
    for (const repo of repositories) {
        const projectId = await getProjectId(repo);
        if (!projectId) continue;

        const commits = await getTodayCommits(projectId);
        if (commits.length > 0) {
            output += `## ${repo}\n`;
            commits.forEach(commit => {
                // output += `- ${commit.title} (작성자: ${commit.author}, 시간: ${commit.created_at}, 브랜치: ${commit.branches.join(', ')})\n`;
                output += `- ${commit.title}\n`;
            });
            output += '\n';
        }
    }

    try {
        const dirPath = './daily-git';
        const today = new Date().toISOString().split('T')[0];
        const fileName = `일일보고서용-Git-${today}.md`;
        const filePath = `${dirPath}/${fileName}`;
        
        // daily-git 폴더가 없으면 생성
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

main(); 