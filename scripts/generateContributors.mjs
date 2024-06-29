import https from 'https';
import fs from 'fs';

const repoOwner = 'ytmdesktop';
const repoName = 'ytmdesktop';

// We are fetching the first 35 contributors
// But we only display the first 30 contributors in the README
// As we are filtering out the bots
const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contributors?per_page=35`;

function fetchContributors() {
  return new Promise((resolve, reject) => {
    const options = {
      method: "GET",
      headers: {
        "User-Agent": "GitHub-Contributors-App" // Add your user agent here
      }
    };

    const request = https.request(apiUrl, options, response => {
      let data = '';
      response.on('data', chunk => {
        data += chunk;
      });

      response.on('end', () => {
        if (response.statusCode === 200) {
          const contributors = JSON.parse(data);
          resolve(contributors);
        } else {
          reject(`Error fetching contributors. Status code: ${response.statusCode}`);
        }
      });
    });

    request.on('error', error => {
      reject(error);
    });

    request.end();
  });
}

function generateMarkdown(contributors) {
  const markdownContent = contributors.map(contributor => {
    if (contributor.type === 'Bot') {
      return null;
    }

    return (
      `[<img alt="${contributor.login}" src="${contributor.avatar_url}&s=240" width="120" height="120">]`+
      `(${contributor.html_url})`
    );
  })
  .filter(contributor => contributor !== null)
  .slice(0, 30)
  .join('\n');

  const readmeContent = (
    `## Contributors`+
    `\n\n`+
    `A Thank you to all the contributors throughout the project, `+
    `without their work this project would have just been a small project `+
    `and never expanded to where it is now.`+
    `\n\n`+
    `${markdownContent}`
  );

  return readmeContent;
}

async function main() {
  try {
    const contributors = await fetchContributors();
    const markdown = generateMarkdown(contributors);

    fs.writeFileSync('CONTRIBUTORS.md', markdown, 'utf8');

    console.log('CONTRIBUTORS.md generated successfully!');
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
