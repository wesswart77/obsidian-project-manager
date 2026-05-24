var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ProjectManagerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  projectsFolder: "Projects"
};
var PM_VIEW_TYPE = "pm-kanban-view";
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function today() {
  return new Date().toISOString().split("T")[0];
}
function fmtDate(d) {
  if (!d)
    return "";
  const parts = d.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}
async function ensureFolder(app, path) {
  const normalized = (0, import_obsidian.normalizePath)(path);
  if (!await app.vault.adapter.exists(normalized)) {
    await app.vault.createFolder(normalized);
  }
}
function buildFrontmatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === void 0 || v === null || v === "")
      continue;
    lines.push(k + ": " + JSON.stringify(v));
  }
  lines.push("---", "");
  return lines.join("\n");
}
async function parseFrontmatter(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  if (cache == null ? void 0 : cache.frontmatter)
    return cache.frontmatter;
  const raw = await app.vault.read(file);
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m)
    return {};
  const result = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0)
      continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    try {
      result[key] = JSON.parse(val);
    } catch (e) {
      result[key] = val;
    }
  }
  return result;
}
async function updateFrontmatterField(app, file, key, value) {
  const content = await app.vault.read(file);
  const match = content.match(/^(---\n[\s\S]*?\n---)/);
  if (!match)
    return;
  const fmBlock = match[1];
  const cleaned = fmBlock.replace(new RegExp("^" + key + ":.*$", "m"), "").replace(/\n{2,}/g, "\n");
  const newFm = cleaned.replace(/\n---$/, "\n" + key + ": " + JSON.stringify(value) + "\n---");
  await app.vault.modify(file, content.replace(match[1], newFm));
}
var NewProjectModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.name = "";
    this.status = "planning";
    this.priority = "medium";
    this.due = "";
    this.description = "";
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pm-modal");
    contentEl.createEl("h2", { text: "New Project" });
    new import_obsidian.Setting(contentEl).setName("Project name").addText((t) => {
      t.setPlaceholder("e.g. Website Redesign");
      t.onChange((v) => this.name = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Status").addDropdown((d) => {
      d.addOption("planning", "Planning");
      d.addOption("active", "Active");
      d.addOption("on-hold", "On Hold");
      d.addOption("complete", "Complete");
      d.setValue("planning");
      d.onChange((v) => this.status = v);
    });
    new import_obsidian.Setting(contentEl).setName("Priority").addDropdown((d) => {
      d.addOption("low", "Low");
      d.addOption("medium", "Medium");
      d.addOption("high", "High");
      d.setValue("medium");
      d.onChange((v) => this.priority = v);
    });
    new import_obsidian.Setting(contentEl).setName("Due date (YYYY-MM-DD)").addText((t) => {
      t.setPlaceholder("2025-12-31");
      t.onChange((v) => this.due = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Description").addTextArea((ta) => {
      ta.setPlaceholder("Brief project description...");
      ta.onChange((v) => this.description = v);
      ta.inputEl.rows = 3;
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Create Project",
      cls: "pm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.name) {
      new import_obsidian.Notice("Project name is required.");
      return;
    }
    await this.plugin.createProject({
      name: this.name,
      status: this.status,
      priority: this.priority,
      due: this.due,
      description: this.description
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AddMilestoneModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.projectName = "";
    this.milestoneName = "";
    this.due = "";
    this.done = false;
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pm-modal");
    contentEl.createEl("h2", { text: "Add Milestone" });
    const projects = await this.plugin.getProjectNames();
    new import_obsidian.Setting(contentEl).setName("Project").addDropdown((d) => {
      if (projects.length === 0) {
        d.addOption("", "\u2014 no projects found \u2014");
      } else {
        projects.forEach((p) => d.addOption(p, p));
        this.projectName = projects[0];
      }
      d.onChange((v) => this.projectName = v);
    });
    new import_obsidian.Setting(contentEl).setName("Milestone name").addText((t) => {
      t.setPlaceholder("e.g. Design mockups approved");
      t.onChange((v) => this.milestoneName = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Due date (YYYY-MM-DD)").addText((t) => {
      t.setPlaceholder("2025-06-30");
      t.onChange((v) => this.due = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Done").addToggle((tog) => {
      tog.setValue(false);
      tog.onChange((v) => this.done = v);
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Add Milestone",
      cls: "pm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.projectName || !this.milestoneName) {
      new import_obsidian.Notice("Project and milestone name are required.");
      return;
    }
    await this.plugin.createMilestone({
      project: this.projectName,
      name: this.milestoneName,
      due: this.due,
      done: this.done
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LogUpdateModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.projectName = "";
    this.updateText = "";
    this.percent = 0;
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pm-modal");
    contentEl.createEl("h2", { text: "Log Update" });
    const projects = await this.plugin.getProjectNames();
    new import_obsidian.Setting(contentEl).setName("Project").addDropdown((d) => {
      if (projects.length === 0) {
        d.addOption("", "\u2014 no projects found \u2014");
      } else {
        projects.forEach((p) => d.addOption(p, p));
        this.projectName = projects[0];
      }
      d.onChange((v) => this.projectName = v);
    });
    new import_obsidian.Setting(contentEl).setName("Update").addTextArea((ta) => {
      ta.setPlaceholder("What happened?");
      ta.onChange((v) => this.updateText = v);
      ta.inputEl.rows = 3;
    });
    const percentDisplay = contentEl.createSpan({ text: "0%" });
    new import_obsidian.Setting(contentEl).setName("% Complete").setDesc("0 \u2013 100").addSlider((sl) => {
      sl.setLimits(0, 100, 5);
      sl.setValue(0);
      sl.onChange((v) => {
        this.percent = v;
        percentDisplay.setText(String(v) + "%");
      });
    }).settingEl.appendChild(percentDisplay);
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Save Update",
      cls: "pm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.projectName) {
      new import_obsidian.Notice("No project selected.");
      return;
    }
    await this.plugin.logUpdate({
      project: this.projectName,
      text: this.updateText,
      percent: this.percent
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ArchiveProjectModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.projectName = "";
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pm-modal");
    contentEl.createEl("h2", { text: "Archive Project" });
    const projects = await this.plugin.getProjectNames();
    new import_obsidian.Setting(contentEl).setName("Project to archive").addDropdown((d) => {
      if (projects.length === 0) {
        d.addOption("", "\u2014 no projects found \u2014");
      } else {
        projects.forEach((p) => d.addOption(p, p));
        this.projectName = projects[0];
      }
      d.onChange((v) => this.projectName = v);
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Archive",
      cls: "pm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.projectName) {
      new import_obsidian.Notice("No project selected.");
      return;
    }
    await this.plugin.archiveProject(this.projectName);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var STATUS_COLUMNS = [
  { key: "planning", label: "Planning" },
  { key: "active", label: "Active" },
  { key: "on-hold", label: "On Hold" },
  { key: "complete", label: "Complete" }
];
var ProjectKanbanView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return PM_VIEW_TYPE;
  }
  getDisplayText() {
    return "Project Manager";
  }
  getIcon() {
    return "layout-kanban";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("pm-sidebar");
    const header = container.createDiv({ cls: "pm-sidebar-header" });
    header.createEl("h2", { text: "Projects" });
    const refreshBtn = header.createEl("button", {
      cls: "pm-btn-icon",
      attr: { title: "Refresh" },
      text: "\u21BB"
    });
    refreshBtn.onclick = () => this.render();
    const projects = await this.plugin.getAllProjectData();
    const kanban = container.createDiv({ cls: "pm-kanban" });
    for (const col of STATUS_COLUMNS) {
      const colProjects = projects.filter((p) => p.status === col.key);
      const colDiv = kanban.createDiv({
        cls: "pm-column pm-column--" + col.key
      });
      const colHeader = colDiv.createDiv({ cls: "pm-column-header" });
      colHeader.createSpan({ cls: "pm-column-title", text: col.label });
      colHeader.createSpan({
        cls: "pm-column-count",
        text: String(colProjects.length)
      });
      const cardsEl = colDiv.createDiv({ cls: "pm-cards" });
      if (colProjects.length === 0) {
        cardsEl.createDiv({ cls: "pm-empty-col", text: "No projects" });
        continue;
      }
      for (const p of colProjects) {
        const card = cardsEl.createDiv({ cls: "pm-card" });
        card.onclick = () => this.app.workspace.openLinkText(p.file.path, "", false);
        const top = card.createDiv({ cls: "pm-card-top" });
        top.createDiv({ cls: "pm-card-name", text: p.name });
        top.createSpan({
          cls: "pm-priority-badge pm-priority-badge--" + p.priority,
          text: p.priority
        });
        const meta = card.createDiv({ cls: "pm-card-meta" });
        const parts = [];
        if (p.due)
          parts.push("Due " + fmtDate(p.due));
        if (p.milestoneCount > 0) {
          parts.push(
            p.milestoneCount + " milestone" + (p.milestoneCount !== 1 ? "s" : "")
          );
        }
        meta.setText(parts.join(" \xB7 "));
        const barBg = card.createDiv({ cls: "pm-progress-bar-bg" });
        const fill = barBg.createDiv({ cls: "pm-progress-bar-fill" });
        fill.style.width = p.percent + "%";
        fill.title = p.percent + "% complete";
      }
    }
  }
  async onClose() {
  }
};
var ProjectManagerSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Project Manager Settings" });
    new import_obsidian.Setting(containerEl).setName("Projects folder").setDesc("Folder where project notes are stored.").addText((t) => {
      t.setPlaceholder("Projects");
      t.setValue(this.plugin.settings.projectsFolder);
      t.onChange(async (v) => {
        this.plugin.settings.projectsFolder = v.trim() || "Projects";
        await this.plugin.saveSettings();
      });
    });
  }
};
var ProjectManagerPlugin = class extends import_obsidian.Plugin {
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
      callback: () => new NewProjectModal(this.app, this).open()
    });
    this.addCommand({
      id: "add-milestone",
      name: "Add Milestone",
      callback: () => new AddMilestoneModal(this.app, this).open()
    });
    this.addCommand({
      id: "log-update",
      name: "Log Update",
      callback: () => new LogUpdateModal(this.app, this).open()
    });
    this.addCommand({
      id: "archive-project",
      name: "Archive Project",
      callback: () => new ArchiveProjectModal(this.app, this).open()
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open Project Manager",
      callback: () => this.activateSidebar()
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
  async activateSidebar() {
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
  refreshSidebarIfOpen() {
    const leaves = this.app.workspace.getLeavesOfType(PM_VIEW_TYPE);
    for (const leaf of leaves) {
      leaf.view.render();
    }
  }
  // ── Data operations ──────────────────────────────────────────────────────
  async createProject(opts) {
    const folder = this.settings.projectsFolder;
    await ensureFolder(this.app, folder);
    const normalized = (0, import_obsidian.normalizePath)(folder + "/" + opts.name + ".md");
    if (await this.app.vault.adapter.exists(normalized)) {
      new import_obsidian.Notice('Project "' + opts.name + '" already exists.');
      return;
    }
    const fm = buildFrontmatter({
      type: "project",
      status: opts.status,
      priority: opts.priority,
      due: opts.due || void 0,
      description: opts.description || void 0,
      percent_complete: 0
    });
    const content = fm + "# " + opts.name + "\n\n" + (opts.description || "") + "\n";
    await this.app.vault.create(normalized, content);
    new import_obsidian.Notice('Project "' + opts.name + '" created.');
  }
  async createMilestone(opts) {
    const folder = (0, import_obsidian.normalizePath)(
      this.settings.projectsFolder + "/Milestones"
    );
    await ensureFolder(this.app, folder);
    const slug = slugify(opts.name);
    const fileName = (0, import_obsidian.normalizePath)(
      folder + "/" + opts.project + " - " + slug + ".md"
    );
    const fm = buildFrontmatter({
      type: "milestone",
      project: opts.project,
      due: opts.due || void 0,
      done: opts.done
    });
    const content = fm + "# " + opts.name + "\n\nProject: [[" + opts.project + "]]\n";
    await this.app.vault.create(fileName, content);
    new import_obsidian.Notice('Milestone "' + opts.name + '" added to ' + opts.project + ".");
  }
  async logUpdate(opts) {
    const folder = (0, import_obsidian.normalizePath)(this.settings.projectsFolder + "/Updates");
    await ensureFolder(this.app, folder);
    const dt = today();
    const slug = slugify(opts.project);
    const fileName = (0, import_obsidian.normalizePath)(folder + "/" + dt + "-" + slug + ".md");
    const fm = buildFrontmatter({
      type: "update",
      project: opts.project,
      date: dt,
      percent_complete: opts.percent
    });
    const content = fm + "# Update \u2013 " + opts.project + " (" + dt + ")\n\n" + opts.text + "\n\n**% Complete:** " + opts.percent + "%\n";
    await this.app.vault.create(fileName, content);
    const projectFile = this.app.vault.getAbstractFileByPath(
      (0, import_obsidian.normalizePath)(
        this.settings.projectsFolder + "/" + opts.project + ".md"
      )
    );
    if (projectFile instanceof import_obsidian.TFile) {
      await updateFrontmatterField(
        this.app,
        projectFile,
        "percent_complete",
        opts.percent
      );
    }
    new import_obsidian.Notice("Update logged for " + opts.project + ".");
  }
  async archiveProject(projectName) {
    const archiveFolder = (0, import_obsidian.normalizePath)(
      this.settings.projectsFolder + "/Archive"
    );
    await ensureFolder(this.app, archiveFolder);
    const src = this.app.vault.getAbstractFileByPath(
      (0, import_obsidian.normalizePath)(
        this.settings.projectsFolder + "/" + projectName + ".md"
      )
    );
    if (!(src instanceof import_obsidian.TFile)) {
      new import_obsidian.Notice('Project file for "' + projectName + '" not found.');
      return;
    }
    const dest = (0, import_obsidian.normalizePath)(archiveFolder + "/" + projectName + ".md");
    await this.app.fileManager.renameFile(src, dest);
    new import_obsidian.Notice('Project "' + projectName + '" archived.');
    this.refreshSidebarIfOpen();
  }
  async getProjectNames() {
    const folder = this.settings.projectsFolder;
    const depth = folder.split("/").length + 1;
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      return f.path.startsWith(folder + "/") && f.path.split("/").length === depth;
    });
    const names = [];
    for (const f of files) {
      const fm = await parseFrontmatter(this.app, f);
      if (fm["type"] === "project")
        names.push(f.basename);
    }
    return names.sort();
  }
  async getAllProjectData() {
    const folder = this.settings.projectsFolder;
    const depth = folder.split("/").length + 1;
    const allFiles = this.app.vault.getMarkdownFiles();
    const projectFiles = allFiles.filter(
      (f) => f.path.startsWith(folder + "/") && f.path.split("/").length === depth
    );
    const milestoneFolder = (0, import_obsidian.normalizePath)(folder + "/Milestones/");
    const milestoneFiles = allFiles.filter(
      (f) => f.path.startsWith(milestoneFolder)
    );
    const milestoneCounts = {};
    for (const mf of milestoneFiles) {
      const fm = await parseFrontmatter(this.app, mf);
      const proj = fm["project"];
      if (proj)
        milestoneCounts[proj] = (milestoneCounts[proj] || 0) + 1;
    }
    const result = [];
    for (const f of projectFiles) {
      const fm = await parseFrontmatter(this.app, f);
      if (fm["type"] !== "project")
        continue;
      result.push({
        file: f,
        name: f.basename,
        status: fm["status"] || "planning",
        priority: fm["priority"] || "medium",
        due: fm["due"] || "",
        description: fm["description"] || "",
        percent: Number(fm["percent_complete"]) || 0,
        milestoneCount: milestoneCounts[f.basename] || 0
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
};
