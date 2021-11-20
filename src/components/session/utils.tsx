export function minifyDelta(delta: any) {
  const res: any = {
    t: delta.type.slice(0, 1),
    v: delta.value,
    p: []
  }

  for (const pos of delta.position) {
    res.p.push({
      i: pos.int,
      s: pos.site,
      c: pos.clock
    });
  }

  return res;
}

export interface IFileTreeNode {
  title: string;
  key: string;
  isLeaf?: boolean;
  children?: IFileTreeNode[]
}

interface IFSEvent {
  type: string;
  oldPath: string;
  newPath: string;
  isLeaf: boolean;
}

enum FSEventTypes {
  Create = "CREATE",
  Remove = "REMOVE",
  Move = "MOVE",
  Rename = "RENAME",
}

class FileTreeNode {
  readonly title: string;
  readonly key: string;
  readonly isLeaf: boolean;
  private children: Map<string, FileTreeNode>;

  constructor(title: string, key: string, isLeaf: boolean) {
    this.title = title;
    this.key = key;
    this.isLeaf = isLeaf;
    this.children = new Map();
  }

  addChild(child: FileTreeNode): boolean {
    if (this.isLeaf) {
      console.log(`ERROR: Attempted to add child to leaf node ${this.key}`);
      return false;
    }

    if (!child.key.startsWith(this.key)) {
      console.log(`ERROR: Child doesn't belong to this subtree. ${this.key} ${child.key}`);
      return false;
    }

    this.children.set(child.key, child); 
    return true;
  }

  removeChild(key: string): boolean {
    if (this.isLeaf) {
      console.log(`ERROR: Tried to remove child from leaf. ${this.key} ${key}`)
      return false;
    }

    if (!this.children.has(key)) {
      console.log(`ERROR: Tried to remove nonexistent child. ${this.key}, ${key}`);
      return false;
    }

    this.children.delete(key);
    return true;
  }

  toObject(): IFileTreeNode {
    if (this.isLeaf) {
      return {
        title: this.title,
        key: this.key,
        isLeaf: true
      }
    }

    const items = {
      files: [] as IFileTreeNode[],
      directories: [] as IFileTreeNode[]
    }

    this.children.forEach(val => {
      if (val.isLeaf) items.files.push(val.toObject());
      else items.directories.push(val.toObject());
    });

    items.directories = items.directories.sort((a, b) => {
      return a.title < b.title ? -1 : 1;
    });

    items.files = items.files.sort((a, b) => {
      return a.title < b.title ? -1 : 1;
    });

    return {
      key: this.key,
      title: this.title,
      children: items.directories.concat(items.files)
    }
  }
}

export class Filesystem {
  tree: FileTreeNode;
  nodes: Map<string, FileTreeNode>;

  constructor() {
    this.tree = new FileTreeNode('', '', false);
    this.nodes = new Map();
    this.nodes.set('', this.tree);
  }

  static getParent(key: string): string {
    return key.split('/').slice(0, -1).join('/');
  }

  static baseName(path: string): string {
    const split = path.split('/');
    return split[split.length - 1];
  }

  toObject(): IFileTreeNode[] {
    return this.tree.toObject().children || [];
  }

  handle(event: IFSEvent) {
    switch (event.type) {
      case FSEventTypes.Create:
        this.handleCreate(event)
        break;

      case FSEventTypes.Remove:
        this.handleRemove(event);
        break;

      case FSEventTypes.Rename:
      case FSEventTypes.Move:
        this.handleMove(event);
        break;

      default:
        console.log(`No Handler for FS Event ${event.type}`);
        break;
    }
  }

  handleCreate(event: IFSEvent) {
    if (this.nodes.has(event.newPath)) return;
    const title = Filesystem.baseName(event.newPath);
    const newNode = new FileTreeNode(title, event.newPath, event.isLeaf);
    this.nodes.set(newNode.key, newNode);
    const parentKey = Filesystem.getParent(newNode.key);
    if (!this.nodes.has(parentKey)) {
      this.handleCreate({
        type: event.type,
        oldPath: '',
        newPath: parentKey,
        isLeaf: false
      });
    }

    const parent = this.nodes.get(parentKey);
    if (parent) {
      parent.addChild(newNode);
    }
  }

  handleRemove(event: IFSEvent) {
    if (!this.nodes.has(event.oldPath)) return;
    const parentKey = Filesystem.getParent(event.oldPath);
    const parent = this.nodes.get(parentKey);
    if (parent) {
      parent.removeChild(event.oldPath);
    }

    this.nodes.delete(event.oldPath);
  }

  handleMove(event: IFSEvent) {
    this.handleRemove(event);
    this.handleCreate(event);
  }
}
