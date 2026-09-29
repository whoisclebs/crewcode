export interface ParserSource {
  filetype: string
  aliases?: string[]
  /** GitHub repository the wasm grammar comes from */
  grammar: string
  /** SPDX identifier of the grammar repository */
  license: string
  wasm: string
  highlights: string[]
}

/** Highlight queries come from nvim-treesitter pinned to a commit so they do not drift between fetches */
export const QUERIES_LICENSE = { repository: "nvim-treesitter/nvim-treesitter", license: "Apache-2.0" }

export const parserSources: ParserSource[] = [
  {
    filetype: "python",
    grammar: "tree-sitter/tree-sitter-python",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/v0.23.6/queries/highlights.scm"],
  },
  {
    filetype: "rust",
    grammar: "tree-sitter/tree-sitter-rust",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/rust/highlights.scm",
    ],
  },
  {
    filetype: "go",
    grammar: "tree-sitter/tree-sitter-go",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/go/highlights.scm",
    ],
  },
  {
    filetype: "cpp",
    grammar: "tree-sitter/tree-sitter-cpp",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/cpp/highlights.scm",
    ],
  },
  {
    filetype: "csharp",
    grammar: "tree-sitter/tree-sitter-c-sharp",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/c_sharp/highlights.scm",
    ],
  },
  {
    filetype: "bash",
    grammar: "tree-sitter/tree-sitter-bash",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/bash/highlights.scm",
    ],
  },
  {
    filetype: "c",
    grammar: "tree-sitter/tree-sitter-c",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/c/highlights.scm",
    ],
  },
  {
    filetype: "java",
    grammar: "tree-sitter/tree-sitter-java",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/java/highlights.scm",
    ],
  },
  {
    filetype: "kotlin",
    grammar: "fwcd/tree-sitter-kotlin",
    license: "MIT",
    wasm: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm",
    highlights: ["https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm"],
  },
  {
    filetype: "ruby",
    grammar: "tree-sitter/tree-sitter-ruby",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/ruby/highlights.scm",
    ],
  },
  {
    filetype: "php",
    grammar: "tree-sitter/tree-sitter-php",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.24.2/tree-sitter-php.wasm",
    highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-php/v0.24.2/queries/highlights.scm"],
  },
  {
    filetype: "scala",
    grammar: "tree-sitter/tree-sitter-scala",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.24.0/tree-sitter-scala.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/scala/highlights.scm",
    ],
  },
  {
    filetype: "html",
    grammar: "tree-sitter/tree-sitter-html",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
    highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-html/v0.23.2/queries/highlights.scm"],
  },
  {
    filetype: "vue",
    grammar: "anomalyco/tree-sitter-vue",
    license: "MIT",
    wasm: "https://github.com/anomalyco/tree-sitter-vue/releases/download/v0.1.2/tree-sitter-vue.wasm",
    highlights: [
      "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/html_tags/highlights.scm",
      "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/vue/highlights.scm",
    ],
  },
  {
    filetype: "hcl",
    grammar: "tree-sitter-grammars/tree-sitter-hcl",
    license: "Apache-2.0",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-hcl/releases/download/v1.2.0/tree-sitter-hcl.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/hcl/highlights.scm",
    ],
  },
  {
    filetype: "json",
    grammar: "tree-sitter/tree-sitter-json",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/json/highlights.scm",
    ],
  },
  {
    filetype: "yaml",
    grammar: "tree-sitter-grammars/tree-sitter-yaml",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/yaml/highlights.scm",
    ],
  },
  {
    filetype: "haskell",
    grammar: "tree-sitter/tree-sitter-haskell",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-haskell/releases/download/v0.23.1/tree-sitter-haskell.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/haskell/highlights.scm",
    ],
  },
  {
    filetype: "css",
    grammar: "tree-sitter/tree-sitter-css",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/css/highlights.scm",
    ],
  },
  {
    filetype: "julia",
    grammar: "tree-sitter/tree-sitter-julia",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-julia/releases/download/v0.23.1/tree-sitter-julia.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/julia/highlights.scm",
    ],
  },
  {
    filetype: "lua",
    grammar: "tree-sitter-grammars/tree-sitter-lua",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.5.0/tree-sitter-lua.wasm",
    highlights: [
      "https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/highlights.scm",
    ],
  },
  {
    filetype: "ocaml",
    grammar: "tree-sitter/tree-sitter-ocaml",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-ocaml/releases/download/v0.24.2/tree-sitter-ocaml.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/ocaml/highlights.scm",
    ],
  },
  {
    filetype: "clojure",
    grammar: "anomalyco/tree-sitter-clojure",
    license: "CC0-1.0",
    wasm: "https://github.com/anomalyco/tree-sitter-clojure/releases/download/v0.0.1/tree-sitter-clojure.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/clojure/highlights.scm",
    ],
  },
  {
    filetype: "swift",
    grammar: "alex-pinkus/tree-sitter-swift",
    license: "MIT",
    wasm: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.1/tree-sitter-swift.wasm",
    highlights: ["https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/main/queries/highlights.scm"],
  },
  {
    filetype: "toml",
    grammar: "tree-sitter-grammars/tree-sitter-toml",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/toml/highlights.scm",
    ],
  },
  {
    filetype: "nix",
    grammar: "ast-grep/ast-grep.github.io",
    license: "MIT",
    wasm: "https://github.com/ast-grep/ast-grep.github.io/raw/40b84530640aa83a0d34a20a2b0623d7b8e5ea97/website/public/parsers/tree-sitter-nix.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/nix/highlights.scm",
    ],
  },
  {
    filetype: "diff",
    aliases: ["udiff", "patch"],
    grammar: "tree-sitter-grammars/tree-sitter-diff",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-diff/releases/download/v0.1.0/tree-sitter-diff.wasm",
    highlights: [
      "https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-diff/2520c3f934b3179bb540d23e0ef45f75304b5fed/queries/highlights.scm",
    ],
  },
  {
    filetype: "elixir",
    grammar: "elixir-lang/tree-sitter-elixir",
    license: "Apache-2.0",
    wasm: "https://github.com/elixir-lang/tree-sitter-elixir/releases/download/v0.3.5/tree-sitter-elixir.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/elixir/highlights.scm",
    ],
  },
  {
    filetype: "fsharp",
    grammar: "ionide/tree-sitter-fsharp",
    license: "MIT",
    wasm: "https://github.com/ionide/tree-sitter-fsharp/releases/download/0.3.0/tree-sitter-fsharp.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/fsharp/highlights.scm",
    ],
  },
  {
    filetype: "r",
    grammar: "r-lib/tree-sitter-r",
    license: "MIT",
    wasm: "https://github.com/r-lib/tree-sitter-r/releases/download/v1.2.0/tree-sitter-r.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/r/highlights.scm",
    ],
  },
  {
    filetype: "make",
    aliases: ["makefile"],
    grammar: "tree-sitter-grammars/tree-sitter-make",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-make/releases/download/v1.1.1/tree-sitter-make.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/make/highlights.scm",
    ],
  },
  {
    filetype: "vim",
    grammar: "tree-sitter-grammars/tree-sitter-vim",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-vim/releases/download/v0.8.1/tree-sitter-vim.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/vim/highlights.scm",
    ],
  },
  {
    filetype: "xml",
    grammar: "tree-sitter-grammars/tree-sitter-xml",
    license: "MIT",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/xml/highlights.scm",
    ],
  },
  {
    filetype: "agda",
    grammar: "tree-sitter/tree-sitter-agda",
    license: "MIT",
    wasm: "https://github.com/tree-sitter/tree-sitter-agda/releases/download/v1.3.3/tree-sitter-agda.wasm",
    highlights: [
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/agda/highlights.scm",
    ],
  },
]
