import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import download from 'github-directory-downloader';
import { Octokit } from 'octokit';
import { compareVersions } from 'compare-versions';

const repoOwner = 'solstice23';
const repoName = 'BetterNCM-Plugins';

const githubToken = process.env.GITHUB_TOKEN;
exec("git config user.name 'github-actions[bot]'");
exec("git config user.email 'github-actions[bot]@users.noreply.github.com'");
const octokit = new Octokit({
	auth: githubToken,
	userAgent: 'betterncm-plugin-updater'
});



const getSlugName = (name) => {
	return name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '-');
};

const isValidPluginJson = (json) => {
	if (!json.name) return false;
	if (!json.repo) return false;
	if (!/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)$/.test(json.repo)) return false;
	return true;
};	

const getPluginList = () => {
	const pluginList = [];
	const pluginListPath = path.resolve(process.cwd(), '../../plugins-list');
	const files = fs.readdirSync(pluginListPath);
	files.forEach((file) => {
		if (!file.endsWith('.json')) {
			return;
		}
		const plugin = JSON.parse(fs.readFileSync(path.join(pluginListPath, file)));
	
		if (!isValidPluginJson(plugin)) {
			return;
		}
		plugin.slug = plugin.slug ?? getSlugName(plugin.name);

		plugin.branch = plugin.branch ?? 'master';

		plugin.subpath = plugin?.subpath ?? '/';
		if (plugin.subpath.endsWith('/')) plugin.subpath = plugin.subpath.slice(0, -1);
		if (!plugin.subpath.startsWith('/')) plugin.subpath = `/${plugin.subpath}`;

		pluginList.push(plugin);
	});
	return pluginList;
}

const getPluginCurrentVersion = (slug) => {
	const pluginPath = path.resolve(process.cwd(), `../../plugins-data/${slug}`);
	if (!fs.existsSync(pluginPath)) return "0";
	const manifest = JSON.parse(fs.readFileSync(path.join(pluginPath, 'manifest.json')));
	return manifest?.version ?? "0";
};

const getPluginListWithCurrentVersion = (pluginList = null) => { // Get plugin list with current version
	if (pluginList === null) {
		pluginList = getPluginList();
	}
	const pluginListWithCurrentVersion = [];
	pluginList.forEach((plugin) => {
		const currentVersion = getPluginCurrentVersion(plugin.slug);
		pluginListWithCurrentVersion.push({
			...plugin,
			currentVersion,
		});
	});
	return pluginListWithCurrentVersion;
}

const getPluginLatestVersion = async (plugin) => {
	const url = `https://raw.githubusercontent.com/${plugin.repo}/${plugin.branch}${plugin.subpath}/manifest.json`;
	try {
		const response = await fetch(url, {
			method: 'GET'
		});
		if (!response.ok) {
			return "0";
		}
		const manifest = await response.json();
		const latestVersion = manifest?.version ?? "0";
		return latestVersion;
	} catch (error) {
		console.log("❌ " + error);
		return "0";
	}	
};

const updatePlugin = async (plugin) => {
	// search if the pull request already exists
	const searchResult = await octokit.rest.search.issuesAndPullRequests({
		q: `repo:${repoOwner}/${repoName} is:pr "${plugin.slug} ${plugin.latestVersion}"`,
	});
	if (searchResult.data.total_count > 0) {
		console.log(`🚫 Pull request already exists for ${plugin.slug} ${plugin.latestVersion}`);
		return;
	}
	console.log(`  - 🔄 Upgrading...`);
	// create new branch
	exec(`git checkout -b master`);
	exec(`git checkout -b update-${plugin.slug}-${plugin.latestVersion}`);	
	// if exists, delete
	const pluginPath = path.resolve(process.cwd(), `../../plugins-data/${plugin.slug}`);
	if (fs.existsSync(pluginPath)) {
		fs.rm(pluginPath, { recursive: true }, (err) => {});
	}
	// download plugin from subpath of given branch of repo
	const stats = await download(
		`https://github.com/${plugin.repo}/tree/${plugin.branch}${plugin.subpath}`,
		path.resolve(process.cwd(), `../../plugins-data/${plugin.slug}`),
		{ token: githubToken }
	);
	console.log(stats);
	// commit
	exec(`git add .`);
	exec(`git commit -m "Update ${plugin.name} to ${plugin.latestVersion}"`);
	// push
	exec(`git push origin update-${plugin.slug}-${plugin.latestVersion}`);
	// create pull request
	const { data: pullRequest } = await octokit.rest.pulls.create({
		owner: repoOwner,
		repo: repoName,
		title: `Update ${plugin.name} to ${plugin.latestVersion}`,
		head: `update-${plugin.slug}-${plugin.latestVersion}`,
		base: 'master'
	});
	console.log(`  - 📝 Pull request created: ${pullRequest.html_url}`);
};

const updateAllPlugins = async (plugins = null) => {
	if (plugins == null) {
		plugins = getPluginListWithCurrentVersion();
	}

	console.log("🔌 Plugin list:");

	for (const plugin of plugins) {
		console.log(`- ${plugin.name} (${plugin.slug})`);
		console.log(`  - Current version: ${plugin.currentVersion}`);
		plugin.latestVersion = await getPluginLatestVersion(plugin);
		console.log(`  - Latest version: ${plugin.currentVersion}`);
		if (compareVersions(plugin.latestVersion, plugin.currentVersion) > 0) {
			console.log(`  - ⏫ Has update!`);
			updatePlugin(plugin);
		} else {
			console.log(`  - ✅ No update`);
			updatePlugin(plugin);
		}
	}
	exec(`git checkout master`);
}
await updateAllPlugins();