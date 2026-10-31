FROM denoland/deno:2.9.8
ENV DENO_NO_PACKAGE_JSON=1 DENO_NO_UPDATE_CHECK=1
ENTRYPOINT ["deno", "run", "--no-config", "--no-lock", "--no-npm", "--no-prompt", "--allow-read", "--allow-write", "--allow-env", "--allow-net", "/github/workspace/scripts/ci-artifact.ts"]
