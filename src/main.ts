import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	normalizePath,
} from "obsidian";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjectStatus = "planning" | "active" | "on-hold" | "complete";
type ProjectPriority = "low" | "medium" | "high";

interface ProjectData {
	file: TFile;
	name: string;
	status: ProjectStatus;
	priority: ProjectPriority;
	due: string;
	description: string;
	percent: number;
	milestoneCount: number;
}

interface ProjectManagerSettings {
	projectsFolder: string;
}

const DEFAULT_SETTINGS: ProjectManagerSettings = {
	projectsFolder: "Projects",
};

const PM_VIEW_TYPE = "pm-kanban-view";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function today(): string {
	return new Date().toISOString().split("T")[0];
}

function fmtDate(d: string): string {
	if (!d) return "";
	const parts = d.split("-");
	return parts[2] + "/" + parts[1] + "/" + parts[0];
}

async function ensureFolder(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	if (!(await app.vault.adapter.exists(normalized))) {
		await app.vault.createFolder(normalized);
	}
}

function buildFrontmatter(obj: Record<string, unknown>): string {
	const lines = ["---"];
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null || v === "") continue;
		lines.push(k + ": " + JSON.stringify(v));
	}
	lines.push("---", "");
	return lines.join("\n");
}

async function parseFrontmatter(
	app: App,
	file: TFile
): Promise<Record<string, unknown>> {
	const cache = app.metadataCache.getFileCache(file);
	if (cache?.frontmatter) return cache.frontmatter as Record<string, unknown>;
	const raw = await app.vault.read(file);
	const m = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return {};
	const result: Record<string, unknown> = {};
	for (const line of m[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const key = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		try {
			result[key] = JSON.parse(val);
		} catch {
			result[key] = val;
		}
	}
	return result;
}

async function updateFrontmatterField(
	app: App,
	file: TFile,
	key: string,
	value: unknown
): Promise<void> {
	const content = await app.vault.read(file);
	const match = content.match(/^(---\n[\s\S]*?\n---)/);
	if (!match) return;
	const fmBlock = match[1];
	const cleaned = fmBlock
		.replace(new RegExp("^" + key + ":.*$", "m"), "")
		.replace(/\n{2,}/g, "\n");
	const newFm = cleaned.replace(/\n---$/, "\n" + key + ": " + JSON.stringify(value) + "\n---");
	await app.vault.modify(file, content.replace(match[1], newFm));
}

// ─── Modals ──────────────────────────────────────────────────────────────────

class NewProjectModal extends Modal {
	private plugin: ProjectManagerPlugin;
	private name = "";
	private status: ProjectStatus = "planning";
	private priority: ProjectPriority = "medium";
	private due = "";
	private description = "";

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("pm-modal");
		contentEl.createEl("h2", { text: "New Project" });

		new Setting(contentEl).setName("Project name").addText((t) => {
			t.setPlaceholder("e.g. Website Redesign");
			t.onChange((v) => (this.name = v.trim()));
		});

		new Setting(contentEl).setName("Status").addDropdown((d) => {
			d.addOption("planning", "Planning");
			d.addOption("active", "Active");
			d.addOption("on-hold", "On Hold");
			d.addOption("complete", "Complete");
			d.setValue("planning");
			d.onChange((v) => (this.status = v as ProjectStatus));
		});

		new Setting(contentEl).setName("Priority").addDropdown((d) => {
			d.addOption("low", "Low");
			d.addOption("medium", "Medium");
			d.addOption("high", "High");
			d.setValue("medium");
			d.onChange((v) => (this.priority = v as ProjectPriority));
		});

		new Setting(contentEl).setName("Due date (YYYY-MM-DD)").addText((t) => {
			t.setPlaceholder("2025-12-31");
			t.onChange((v) => (this.due = v.trim()));
		});

		new Setting(contentEl).setName("Description").addTextArea((ta) => {
			ta.setPlaceholder("Brief project description...");
			ta.onChange((v) => (this.description = v));
			ta.inputEl.rows = 3;
		});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Create Project",
			cls: "pm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.name) {
			new Notice("Project name is required.");
			return;
		}
		await this.plugin.createProject({
			name: this.name,
			status: this.status,
			priority: this.priority,
			due: this.due,
			description: this.description,
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class AddMilestoneModal extends Modal {
	private plugin: ProjectManagerPlugin;
	private projectName = "";
	private milestoneName = "";
	private due = "";
	private done = false;

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("pm-modal");
		contentEl.createEl("h2", { text: "Add Milestone" });

		const projects = await this.plugin.getProjectNames();

		new Setting(contentEl).setName("Project").addDropdown((d) => {
			if (projects.length === 0) {
				d.addOption("", "— no projects found —");
			} else {
				projects.forEach((p) => d.addOption(p, p));
				this.projectName = projects[0];
			}
			d.onChange((v) => (this.projectName = v));
		});

		new Setting(contentEl).setName("Milestone name").addText((t) => {
			t.setPlaceholder("e.g. Design mockups approved");
			t.onChange((v) => (this.milestoneName = v.trim()));
		});

		new Setting(contentEl).setName("Due date (YYYY-MM-DD)").addText((t) => {
			t.setPlaceholder("2025-06-30");
			t.onChange((v) => (this.due = v.trim()));
		});

		new Setting(contentEl).setName("Done").addToggle((tog) => {
			tog.setValue(false);
			tog.onChange((v) => (this.done = v));
		});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Add Milestone",
			cls: "pm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.projectName || !this.milestoneName) {
			new Notice("Project and milestone name are required.");
			return;
		}
		await this.plugin.createMilestone({
			project: this.projectName,
			name: this.milestoneName,
			due: this.due,
			done: this.done,
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class LogUpdateModal extends Modal {
	private plugin: ProjectManagerPlugin;
	private projectName = "";
	private updateText = "";
	private percent = 0;

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("pm-modal");
		contentEl.createEl("h2", { text: "Log Update" });

		const projects = await this.plugin.getProjectNames();

		new Setting(contentEl).setName("Project").addDropdown((d) => {
			if (projects.length === 0) {
				d.addOption("", "— no projects found —");
			} else {
				projects.forEach((p) => d.addOption(p, p));
				this.projectName = projects[0];
			}
			d.onChange((v) => (this.projectName = v));
		});

		new Setting(contentEl).setName("Update").addTextArea((ta) => {
			ta.setPlaceholder("What happened?");
			ta.onChange((v) => (this.updateText = v));
			ta.inputEl.rows = 3;
		});

		const percentDisplay = contentEl.createSpan({ text: "0%" });
		new Setting(contentEl)
			.setName("% Complete")
			.setDesc("0 – 100")
			.addSlider((sl) => {
				sl.setLimits(0, 100, 5);
				sl.setValue(0);
				sl.onChange((v) => {
					this.percent = v;
					percentDisplay.setText(String(v) + "%");
				});
			})
			.settingEl.appendChild(percentDisplay);

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Save Update",
			cls: "pm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.projectName) {
			new Notice("No project selected.");
			return;
		}
		await this.plugin.logUpdate({
			project: this.projectName,
			text: this.updateText,
			percent: this.percent,
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class ArchiveProjectModal extends Modal {
	private plugin: ProjectManagerPlugin;
	private projectName = "";

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("pm-modal");
		contentEl.createEl("h2", { text: "Archive Project" });

		const projects = await this.plugin.getProjectNames();

		new Setting(contentEl).setName("Project to archive").addDropdown((d) => {
			if (projects.length === 0) {
				d.addOption("", "— no projects found —");
			} else {
				projects.forEach((p) => d.addOption(p, p));
				this.projectName = projects[0];
			}
			d.onChange((v) => (this.projectName = v));
		});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Archive",
			cls: "pm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.projectName) {
			new Notice("No project selected.");
			return;
		}
		await this.plugin.archiveProject(this.projectName);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ─── Sidebar View ─────────────────────────────────────────────────────────────

const STATUS_COLUMNS: Array<{ key: ProjectStatus; label: string }> = [
	{ key: "planning", label: "Planning" },
	{ key: "active", label: "Active" },
	{ key: "on-hold", label: "On Hold" },
	{ key: "complete", label: "Complete" },
];

class ProjectKanbanView extends ItemView {
	private plugin: ProjectManagerPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return PM_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Project Manager";
	}

	getIcon(): string {
		return "layout-kanban";
	}

	async onOpen() {
		await this.render();
	}

	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pm-sidebar");

		const header = container.createDiv({ cls: "pm-sidebar-header" });
		header.createEl("h2", { text: "Projects" });
		const refreshBtn = header.createEl("button", {
			cls: "pm-btn-icon",
			attr: { title: "Refresh" },
			text: "↻",
		});
		refreshBtn.onclick = () => this.render();

		const projects = await this.plugin.getAllProjectData();
		const kanban = container.createDiv({ cls: "pm-kanban" });

		for (const col of STATUS_COLUMNS) {
			const colProjects = projects.filter((p) => p.status === col.key);
			const colDiv = kanban.createDiv({
				cls: "pm-column pm-column--" + col.key,
			});

			const colHeader = colDiv.createDiv({ cls: "pm-column-header" });
			colHeader.createSpan({ cls: "pm-column-title", text: col.label });
			colHeader.createSpan({
				cls: "pm-column-count",
				text: String(colProjects.length),
			});

			const cardsEl = colDiv.createDiv({ cls: "pm-cards" });

			if (colProjects.length === 0) {
				cardsEl.createDiv({ cls: "pm-empty-col", text: "No projects" });
				continue;
			}

			for (const p of colProjects) {
				const card = cardsEl.createDiv({ cls: "pm-card" });
				card.onclick = () =>
					this.app.workspace.openLinkText(p.file.path, "", false);

				const top = card.createDiv({ cls: "pm-card-top" });
				top.createDiv({ cls: "pm-card-name", text: p.name });
				top.createSpan({
					cls: "pm-priority-badge pm-priority-badge--" + p.priority,
					text: p.priority,
				});

				const meta = card.createDiv({ cls: "pm-card-meta" });
				const parts: string[] = [];
				if (p.due) parts.push("Due " + fmtDate(p.due));
				if (p.milestoneCount > 0) {
					parts.push(
						p.milestoneCount +
							" milestone" +
							(p.milestoneCount !== 1 ? "s" : "")
					);
				}
				meta.setText(parts.join(" · "));

				const barBg = card.createDiv({ cls: "pm-progress-bar-bg" });
				const fill = barBg.createDiv({ cls: "pm-progress-bar-fill" });
				fill.style.width = p.percent + "%";
				fill.title = p.percent + "% complete";
			}
		}
	}

	async onClose() {
		// nothing
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class ProjectManagerSettingTab extends PluginSettingTab {
	private plugin: ProjectManagerPlugin;

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Project Manager Settings" });

		new Setting(containerEl)
			.setName("Projects folder")
			.setDesc("Folder where project notes are stored.")
			.addText((t) => {
				t.setPlaceholder("Projects");
				t.setValue(this.plugin.settings.projectsFolder);
				t.onChange(async (v) => {
					this.plugin.settings.projectsFolder = v.trim() || "Projects";
					await this.plugin.saveSettings();
				});
			});
	}
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class ProjectManagerPlugin extends Plugin {
	settings!: ProjectManagerSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			PM_VIEW_TYPE,
			(leaf) => new ProjectKanbanView(leaf, this)
		);

		this.addRibbonIcon("layout-kanban", "Project Manager", () => {
			this.activateSidebar();
		});

		this.addCommand({
			id: "new-project",
			name: "New Project",
			callback: () => new NewProjectModal(this.app, this).open(),
		});

		this.addCommand({
			id: "add-milestone",
			name: "Add Milestone",
			callback: () => new AddMilestoneModal(this.app, this).open(),
		});

		this.addCommand({
			id: "log-update",
			name: "Log Update",
			callback: () => new LogUpdateModal(this.app, this).open(),
		});

		this.addCommand({
			id: "archive-project",
			name: "Archive Project",
			callback: () => new ArchiveProjectModal(this.app, this).open(),
		});

		this.addCommand({
			id: "open-sidebar",
			name: "Open Project Manager",
			callback: () => this.activateSidebar(),
		});

		this.addSettingTab(new ProjectManagerSettingTab(this.app, this));

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.refreshSidebarIfOpen();
			})
		);
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(PM_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async activateSidebar() {
		const existing = this.app.workspace.getLeavesOfType(PM_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: PM_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private refreshSidebarIfOpen() {
		const leaves = this.app.workspace.getLeavesOfType(PM_VIEW_TYPE);
		for (const leaf of leaves) {
			(leaf.view as ProjectKanbanView).render();
		}
	}

	// ── Data operations ──────────────────────────────────────────────────────

	async createProject(opts: {
		name: string;
		status: ProjectStatus;
		priority: ProjectPriority;
		due: string;
		description: string;
	}) {
		const folder = this.settings.projectsFolder;
		await ensureFolder(this.app, folder);
		const normalized = normalizePath(folder + "/" + opts.name + ".md");
		if (await this.app.vault.adapter.exists(normalized)) {
			new Notice('Project "' + opts.name + '" already exists.');
			return;
		}
		const fm = buildFrontmatter({
			type: "project",
			status: opts.status,
			priority: opts.priority,
			due: opts.due || undefined,
			description: opts.description || undefined,
			percent_complete: 0,
		});
		const content = fm + "# " + opts.name + "\n\n" + (opts.description || "") + "\n";
		await this.app.vault.create(normalized, content);
		new Notice('Project "' + opts.name + '" created.');
	}

	async createMilestone(opts: {
		project: string;
		name: string;
		due: string;
		done: boolean;
	}) {
		const folder = normalizePath(
			this.settings.projectsFolder + "/Milestones"
		);
		await ensureFolder(this.app, folder);
		const slug = slugify(opts.name);
		const fileName = normalizePath(
			folder + "/" + opts.project + " - " + slug + ".md"
		);
		const fm = buildFrontmatter({
			type: "milestone",
			project: opts.project,
			due: opts.due || undefined,
			done: opts.done,
		});
		const content =
			fm + "# " + opts.name + "\n\nProject: [[" + opts.project + "]]\n";
		await this.app.vault.create(fileName, content);
		new Notice('Milestone "' + opts.name + '" added to ' + opts.project + ".");
	}

	async logUpdate(opts: {
		project: string;
		text: string;
		percent: number;
	}) {
		const folder = normalizePath(this.settings.projectsFolder + "/Updates");
		await ensureFolder(this.app, folder);
		const dt = today();
		const slug = slugify(opts.project);
		const fileName = normalizePath(folder + "/" + dt + "-" + slug + ".md");
		const fm = buildFrontmatter({
			type: "update",
			project: opts.project,
			date: dt,
			percent_complete: opts.percent,
		});
		const content =
			fm +
			"# Update – " +
			opts.project +
			" (" +
			dt +
			")\n\n" +
			opts.text +
			"\n\n**% Complete:** " +
			opts.percent +
			"%\n";
		await this.app.vault.create(fileName, content);

		// Update the project note's percent_complete
		const projectFile = this.app.vault.getAbstractFileByPath(
			normalizePath(
				this.settings.projectsFolder + "/" + opts.project + ".md"
			)
		);
		if (projectFile instanceof TFile) {
			await updateFrontmatterField(
				this.app,
				projectFile,
				"percent_complete",
				opts.percent
			);
		}
		new Notice("Update logged for " + opts.project + ".");
	}

	async archiveProject(projectName: string) {
		const archiveFolder = normalizePath(
			this.settings.projectsFolder + "/Archive"
		);
		await ensureFolder(this.app, archiveFolder);
		const src = this.app.vault.getAbstractFileByPath(
			normalizePath(
				this.settings.projectsFolder + "/" + projectName + ".md"
			)
		);
		if (!(src instanceof TFile)) {
			new Notice('Project file for "' + projectName + '" not found.');
			return;
		}
		const dest = normalizePath(archiveFolder + "/" + projectName + ".md");
		await this.app.fileManager.renameFile(src, dest);
		new Notice('Project "' + projectName + '" archived.');
		this.refreshSidebarIfOpen();
	}

	async getProjectNames(): Promise<string[]> {
		const folder = this.settings.projectsFolder;
		const depth = folder.split("/").length + 1;
		const files = this.app.vault.getMarkdownFiles().filter((f) => {
			return (
				f.path.startsWith(folder + "/") &&
				f.path.split("/").length === depth
			);
		});
		const names: string[] = [];
		for (const f of files) {
			const fm = await parseFrontmatter(this.app, f);
			if (fm["type"] === "project") names.push(f.basename);
		}
		return names.sort();
	}

	async getAllProjectData(): Promise<ProjectData[]> {
		const folder = this.settings.projectsFolder;
		const depth = folder.split("/").length + 1;
		const allFiles = this.app.vault.getMarkdownFiles();

		const projectFiles = allFiles.filter(
			(f) =>
				f.path.startsWith(folder + "/") &&
				f.path.split("/").length === depth
		);

		const milestoneFolder = normalizePath(folder + "/Milestones/");
		const milestoneFiles = allFiles.filter((f) =>
			f.path.startsWith(milestoneFolder)
		);

		const milestoneCounts: Record<string, number> = {};
		for (const mf of milestoneFiles) {
			const fm = await parseFrontmatter(this.app, mf);
			const proj = fm["project"] as string;
			if (proj)
				milestoneCounts[proj] = (milestoneCounts[proj] || 0) + 1;
		}

		const result: ProjectData[] = [];
		for (const f of projectFiles) {
			const fm = await parseFrontmatter(this.app, f);
			if (fm["type"] !== "project") continue;
			result.push({
				file: f,
				name: f.basename,
				status: (fm["status"] as ProjectStatus) || "planning",
				priority: (fm["priority"] as ProjectPriority) || "medium",
				due: (fm["due"] as string) || "",
				description: (fm["description"] as string) || "",
				percent: Number(fm["percent_complete"]) || 0,
				milestoneCount: milestoneCounts[f.basename] || 0,
			});
		}

		return result.sort((a, b) => a.name.localeCompare(b.name));
	}
}
