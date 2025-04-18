import fs from 'fs'
import path from 'path'

interface Module {
  name: string
  path: string
  content?: string
}

function createExecutableFromProject(project: Module[]): [string, Module[]] {
  const getModFnName = (name: string) => name
    .replace(/\./g, '_')
    .replace(/^_/, '')

  const contents: Module[] = []

  // filter out repeated modules with different import names
  // and construct the executable Lua code
  // (the main file content is handled separately)
  for (let i = 0; i < project.length - 1; i++) {
    const mod = project[i]
    const existing = contents.find((m) => m.path === mod.path)
    const moduleContent =
      (!existing &&
        `-- module: "${mod.name}"\nlocal function _loaded_mod_${getModFnName(mod.name)}()\n${mod.content}\nend\n`) ||
      '';
    const requireMapper = `\n_G.package.loaded["${mod.name}"] = _loaded_mod_${getModFnName(existing?.name || mod.name)}()`;

    contents.push({
      ...mod,
      content: moduleContent + requireMapper,
    });
  }

  // finally, add the main file
  contents.push(project[project.length - 1]);

  return [
    contents.reduce((acc, con) => acc + '\n\n' + con.content, ''),
    contents,
  ];
}

function createProjectStructure(mainFile: string): Module[] {
  const sorted: Module[] = []
  const cwd = path.dirname(mainFile)

  // checks if the sorted module list already includes a node
  const isSorted = (node: Module): Module | undefined =>
    sorted.find((sortedNode) => sortedNode.path === node.path)

  // recursive dfs algorithm
  function dfs(currentNode: Module) {
    const unvisitedChildNodes = exploreNodes(currentNode, cwd).filter(
      (node) => !isSorted(node),
    );

    for (let i = 0; i < unvisitedChildNodes.length; i++) {
      dfs(unvisitedChildNodes[i]);
    }

    if (!isSorted(currentNode)) sorted.push(currentNode);
  }

  // run DFS from the main file
  dfs({ name: 'main', path: mainFile })

  return sorted.filter(
    // modules that were not read don't exist locally
    // aos assumes that these modules have already been
    // loaded into the process, or they're default modules
    (mod) => !!mod.content
  )
}

function exploreNodes(node: Module, cwd: string): Module[] {
  if (!fs.existsSync(node.path)) return [];

  // set content
  node.content = fs.readFileSync(node.path, 'utf-8');

  const requirePattern = /(?<=(require( *)(\n*)(\()?( *)("|'))).*(?=("|'))/g;
  const requiredModules =
    node.content.match(requirePattern)?.map((mod) => ({
      name: mod,
      path: path.join(cwd, mod.replace(/\./g, '/') + '.lua'),
      content: undefined,
    })) || [];

  return requiredModules;
}

export function bundleLua(entryLuaPath: string) {
  const project = createProjectStructure(entryLuaPath)
  const [bundledLua] = createExecutableFromProject(project)

  return bundledLua
}
