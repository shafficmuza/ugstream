module.exports = {
  apps: [
    {
      name: 'ugstream-backend',
      cwd: '/root/ugstream/backend',
      script: 'dist/src/main.js',
    },
    {
      name: 'ugstream-frontend',
      cwd: '/root/ugstream/frontend',
      script: 'npm',
      args: 'start',
      env: { PORT: '4011' },
    },
  ],
};
