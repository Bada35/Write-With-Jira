import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const GITLAB_DOMAIN = process.env.GITLAB_DOMAIN || 'gitlab.com';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const TODAY = new Date().toISOString().split('T')[0]; // 전역 변수로 today 선언

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
    try {
        const response = await fetch(
            `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits?since=${TODAY}T00:00:00Z&all=true`,
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

// 사용자별 커밋을 그룹화하는 함수
function groupCommitsByAuthor(commits) {
    const authorCommits = {};
    
    commits.forEach(commit => {
        if (!authorCommits[commit.author]) {
            authorCommits[commit.author] = [];
        }
        authorCommits[commit.author].push(commit);
    });
    
    return authorCommits;
}

async function main() {
    let output = `# ${TODAY} 커밋 내역\n\n`;
    const totalAuthorCommits = {};
    
    // 저장소별 처리
    for (const repo of repositories) {
        const projectId = await getProjectId(repo);
        if (!projectId) continue;

        const commits = await getTodayCommits(projectId);
        if (commits.length > 0) {
            output += `## ${repo}\n`;
            
            // 사용자별로 커밋 그룹화
            const authorCommits = groupCommitsByAuthor(commits);
            
            // 사용자별 커밋 내역 출력
            for (const author in authorCommits) {
                const userCommits = authorCommits[author];
                output += `### ${author} (${userCommits.length}개 커밋)\n`;
                
                userCommits.forEach(commit => {
                    output += `- ${commit.title} (브랜치: ${commit.branches.join(', ')})\n`;
                });
                output += '\n';
                
                // 전체 사용자별 통계 업데이트
                if (!totalAuthorCommits[author]) {
                    totalAuthorCommits[author] = 0;
                }
                totalAuthorCommits[author] += userCommits.length;
            }
        }
    }
    
    // 전체 사용자별 커밋 수 요약
    output += `## 개발자별 총 커밋 수\n`;
    for (const author in totalAuthorCommits) {
        output += `- ${author}: ${totalAuthorCommits[author]}개 커밋\n`;
    }
    output += '\n';

    try {
        const dirPath = './daily-git';
        const fileName = `일일보고서용-Git-${TODAY}.md`;
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