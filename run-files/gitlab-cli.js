import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const GITLAB_DOMAIN = process.env.GITLAB_DOMAIN || 'gitlab.com';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

// 날짜 변수 설정 - 환경 변수로 지정된 날짜 또는 현재 날짜 사용
const TARGET_DATE = process.env.TARGET_DATE; // 형식: YYYY-MM-DD
const TODAY = TARGET_DATE || new Date().toISOString().split('T')[0]; 

console.log(`보고서 날짜: ${TODAY}`);

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
        // 해당 날짜의 시작과 끝 시간 설정
        const startTime = `${TODAY}T00:00:00Z`;
        const endTime = `${TODAY}T23:59:59Z`;

        console.log(`커밋 조회 기간: ${startTime} ~ ${endTime}`);
        
        // 페이지 크기와 페이지 번호 설정
        const perPage = 100; // 한 페이지당 최대 항목 수
        const page = 1;      // 첫 페이지
        
        const response = await fetch(
            `https://${GITLAB_DOMAIN}/api/v4/projects/${projectId}/repository/commits?since=${startTime}&until=${endTime}&all=true&per_page=${perPage}&page=${page}`,
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
        console.log(`프로젝트 ${projectId}에서 총 ${commits.length}개의 커밋을 발견했습니다.`);
        
        // Merge branch로 시작하는 커밋 필터링
        const filteredCommits = commits.filter(commit => !commit.title.startsWith('Merge branch'));
        console.log(`Merge 커밋 필터링 후 ${filteredCommits.length}개 남음`);
        
        // 각 커밋의 브랜치 정보 가져오기 및 표시 이름 조회
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
                
                // 커밋 정보에서 직접 author_name 사용 (이미 실제 이름으로 표시됨)
                // GitLab은 커밋 정보에 이미 author_name을 실제 이름으로 제공함
                const displayName = commit.author_name;
                // console.log(`커밋 작성자: ${displayName}`);
                
                // 커밋 생성 시간 객체 생성
                const commitDate = new Date(commit.created_at);
                
                return {
                    title: commit.title,
                    author: displayName,
                    username: commit.author_email || commit.author_name, // 이메일 정보가 있으면 사용
                    created_at: commitDate.toLocaleString(),
                    commit_date: commitDate,
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
    // 사용자 매핑 로드 (이미 구현된 경우)
    // await loadUserMappingFromFile();
    
    let output = `# ${TODAY} 커밋 내역\n\n`;
    
    // 저장소별 저자 커밋 추적
    const repoAuthorCommits = {};
    // 전체 저자 커밋 통계
    const totalAuthorCommits = {};
    
    // 저장소별 처리
    for (const repo of repositories) {
        const projectId = await getProjectId(repo);
        if (!projectId) continue;

        const commits = await getTodayCommits(projectId);
        if (commits.length > 0) {
            // 저장소 정보 저장
            repoAuthorCommits[repo] = {};
            
            // 사용자별로 커밋 그룹화
            const authorCommits = groupCommitsByAuthor(commits);
            
            // 사용자별 커밋 내역 출력
            for (const author in authorCommits) {
                const userCommits = authorCommits[author];
                
                // 저장소별 사용자 통계 추가
                repoAuthorCommits[repo][author] = userCommits.length;
                
                // 전체 사용자별 통계 업데이트
                if (!totalAuthorCommits[author]) {
                    totalAuthorCommits[author] = 0;
                }
                totalAuthorCommits[author] += userCommits.length;
            }
        }
    }
    
    // 팀별 개발자 커밋 수 요약을 맨 앞에 배치
    output += `## 팀별 개발자 커밋 수\n`;
    
    for (const repo in repoAuthorCommits) {
        output += `### ${repo}\n`;
        const authorStats = repoAuthorCommits[repo];
        
        // 이름 기준 가나다순(사전순) 정렬
        const sortedAuthors = Object.entries(authorStats)
            .sort((a, b) => {
                // 한글 이름 비교를 위한 로케일 비교(사전순)
                return a[0].localeCompare(b[0], 'ko-KR');
            })
            .map(([author, count]) => `- ${author}: ${count}개 커밋`);
        
        output += sortedAuthors.join('\n') + '\n\n';
    }
    
    // 각 저장소별 상세 커밋 내역
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
                    output += `- ${commit.title} \n`;
                });
                output += '\n';
            }
        }
    }
    
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