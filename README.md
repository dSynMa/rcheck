# R-CHECK language support for VS Code

This repository contains a VS Code extension to support the R-CHECK
language for reconfigurable interacting systems.

It is based on [Langium](https://langium.org/).

## Quickstart

```bash
git clone https://github.com/dSynMa/rcheck.git  # Clones the repo
cd rcheck 
git submodule update --remote
make package
```

This creates a `.vsix` package in the root directory, which can be installed in
VSCode by selecting `Extensions: Install from VSIX...` from the command palette.

## Instructions -- debugging

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

[1] Yehia Abd Alrahman, Shaun Azzopardi, Luca Di Stefano, and Nir Piterman. 2023. Language support for verifying reconfigurable interacting systems. Int J Softw Tools Technol Transfer (November 2023). https://doi.org/10.1007/s10009-023-00729-8

[2] Yehia Abd Alrahman and Nir Piterman. 2021. Modelling and verification of reconfigurable multi-agent systems. Auton. Agents Multi Agent Syst. 35, 2 (2021), 47. https://doi.org/10.1007/s10458-021-09521-x

