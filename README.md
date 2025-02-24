# R-CHECK language support for VS Code

This repository contains a VS Code extension to support the R-CHECK
language for reconfigurable interacting systems.

It is based on [Langium](https://langium.org/).

## Quickstart — installation

```bash
git clone https://github.com/dSynMa/rcheck.git  # Clones the repo
cd rcheck 
git submodule update --remote
make package
```

This creates a `.vsix` package in the root directory, which can be installed in
VSCode by selecting `Extensions: Install from VSIX...` from the command palette.

## Quickstart — usage

The extension should activate as soon as an `.rcp` file is opened.
Folder `example` contains a number of sample files.

The extension provides the following commands from the command palette (`Ctrl-R` or `Cmd-R` depending on the operating system):

* *R-CHECK: Show agents' transition systems*: This will visualize the behaviour of each agent in the current system as a symbolic automaton. Requires either the [Graphviz Interactive Preview extension](https://marketplace.visualstudio.com/items?itemName=tintinweb.graphviz-interactive-preview) (recommended), or the [`graphviz`](https://graphviz.org/) software package.

* *R-CHECK: Model-check using IC3*: This will model check all specifications in the current file. Requires the [`nuxmv`](https://nuxmv.fbk.eu/) tool.


## Instructions — debugging

We assume that Langium is already installed.

```bash
git clone https://github.com/dSynMa/rcheck.git  # Clones the repo
cd rcheck 
git submodule update --remote
make all
code .  # Opens repository in VS Code
```

Notice that running `make all` is equivalent to running the commands `npm run langium:generate` followed by `npm run build`.

Then, run `Debug: start debugging` from Code's command palette (default shortcut is `[F5]`).
This will open a new VS Code window with the extension pre-loaded.

## References 

[1] Yehia Abd Alrahman, Shaun Azzopardi, Luca Di Stefano, and Nir Piterman. Language support for verifying reconfigurable interacting systems. Int J Softw Tools Technol Transfer 25 (2023). https://doi.org/10.1007/s10009-023-00729-8

[2] Yehia Abd Alrahman and Nir Piterman. Modelling and verification of reconfigurable multi-agent systems. Auton. Agents Multi Agent Syst. 35, 2 (2021). https://doi.org/10.1007/s10458-021-09521-x

[3] Yehia Abd Alrahman, Shaun Azzopardi, Luca Di Stefano, and Nir Piterman. Attributed Point-to-Point Communication in R-CHECK. In ISoLA'24. LNCS vol. 15220, Springer, 2024. https://doi.org/10.1007/978-3-031-75107-3_20
