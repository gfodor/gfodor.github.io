import esbuild from 'esbuild'
import esbuildServe from 'esbuild-serve'

esbuildServe(
  {
    entryPoints: ['src/index.js'],
    bundle: true,
    target: 'es2015',
    outfile: 'dist/bundle.js',
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV === 'development',
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: {
      '.js': 'jsx'
    },
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment'
  },
  {
    // serve options (optional)
    port: 7000,
    root: '.'
  }
)
