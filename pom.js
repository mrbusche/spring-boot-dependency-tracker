import { XMLParser } from 'fast-xml-parser';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { parse } from 'node-html-parser';
import { cachePath, ensureDirExists, getDefaultSpringBootVersions, getJsonFromFile, Package } from './shared.js';

export const getXMLFromFile = async (filename) => {
  try {
    const parser = new XMLParser();

    const parsedPomFiles = [];
    const files = [];
    readdirSync('./', { recursive: true }).forEach((file) => {
      if (file.endsWith(filename)) {
        files.push(file);
      }
    });
    for (const file of files) {
      const xmlData = readFileSync(file, 'utf8');
      parsedPomFiles.push(parser.parse(xmlData));
    }

    let properties = [];
    let dependencies = [];
    let dependencyManagement = [];
    let parent = [];
    parsedPomFiles.forEach((pom) => {
      properties = properties.concat(pom.project.properties ?? []);
      dependencies = dependencies.concat(pom.project.dependencies ?? []);
      dependencyManagement = dependencyManagement.concat(pom.project.dependencyManagement ?? []);
      parent = parent.concat(pom.project.parent ?? []);
    });

    return {
      project: {
        properties: properties,
        dependencies: dependencies,
        dependencyManagement: dependencyManagement,
        parent: parent,
      },
    };
  } catch (err) {
    return [];
  }
};

export const getPomProperties = async (parsedPom) => {
  let properties = [];
  if (Array.isArray(parsedPom.project.properties)) {
    parsedPom.project.properties.forEach((property) => {
      properties = properties.concat(Object.keys(property));
    });
  }
  return properties;
};

const getSpringBootProperties = async (filename) => {
  await getSpringDefaultProperties(filename);
  return getJsonFromFile(`${cachePath}/properties_${filename}.json`);
};

export const getPomDependenciesWithVersions = async (parsedPom) => {
  let allDependencies = [];
  if (Array.isArray(parsedPom.project.dependencies)) {
    parsedPom?.project.dependencies.forEach((pom) => {
      allDependencies = allDependencies.concat(pom.dependency);
    });
  }
  if (Array.isArray(parsedPom.project.dependencyManagement)) {
    parsedPom?.project.dependencyManagement.forEach((pom) => {
      allDependencies = allDependencies.concat(pom.dependencies.dependency);
    });
  }
  return allDependencies.filter((dep) => dep?.version);
};

export const getPomSpringBootVersion = async (parsedPom) => {
  let bootVersion = parsedPom.project.parent.filter(
    (pom) => pom.groupId === 'org.springframework.boot' && pom.artifactId === 'spring-boot-starter-parent',
  );
  if (bootVersion.length) {
    return bootVersion[0].version;
  }

  bootVersion = parsedPom.project.dependencyManagement?.dependencies?.dependency.filter(
    (pom) => pom.groupId === 'org.springframework.boot' && pom.artifactId === 'spring-boot-starter-parent',
  );
  if (bootVersion) {
    const tempBootVersion = bootVersion.version;
    return replaceVariable(parsedPom.project.properties, tempBootVersion);
  }

  if (Array.isArray(parsedPom.project?.dependencyManagement?.[0]?.dependencies.dependency)) {
    const bootVersion = parsedPom.project?.dependencyManagement?.[0]?.dependencies.dependency.find(
      (dependency) => dependency.groupId === 'org.springframework.boot' && dependency.artifactId === 'spring-boot-dependencies',
    )?.version;
    if (bootVersion) {
      return replaceVariable(parsedPom.project.properties, bootVersion);
    }
  }
  if (
    parsedPom.project?.dependencyManagement?.[0]?.dependencies?.dependency?.groupId === 'org.springframework.boot' &&
    parsedPom.project?.dependencyManagement?.[0]?.dependencies?.dependency?.artifactId === 'spring-boot-dependencies'
  ) {
    return replaceVariable(parsedPom.project.properties, parsedPom.project.dependencyManagement[0].dependencies.dependency.version);
  }
  // if (parsedPom?.project?.properties['spring.boot.version']) {
  //     return parsedPom.project.properties['spring.boot.version']
  // }
  // if (parsedPom?.project?.properties['spring-boot.version']) {
  //     return parsedPom.project.properties['spring-boot.version']
  // }
  console.log('No Spring Boot version found.');
  return '';
};

export const retrieveSimilarPomPackages = async (parsedPom, springBootVersion) => {
  const pomDependenciesWithVersions = await getPomDependenciesWithVersions(parsedPom);
  if (springBootVersion) {
    const defaultVersions = await getDefaultSpringBootVersions(springBootVersion);

    if (defaultVersions.length) {
      const declaredPackages = [];
      for (const pomDependency of pomDependenciesWithVersions) {
        for (const bootPackage of defaultVersions) {
          if (pomDependency.groupId === bootPackage.group && pomDependency.artifactId === bootPackage.name) {
            const pomVersion = replaceVariable(parsedPom.project.properties, pomDependency.version);
            const existingMatches = declaredPackages.find(
              (declaredPackage) => declaredPackage.group === pomDependency.groupId && declaredPackage.name === pomDependency.artifactId,
            );
            if (!existingMatches) {
              declaredPackages.push(new Package(pomDependency.groupId, pomDependency.artifactId, pomVersion, bootPackage.version));
              break;
            }
          }
        }
      }

      console.log('Declared Pom Package Count -', declaredPackages.length);
      if (declaredPackages.length) {
        console.log('Declared Pom Packages -', declaredPackages);
      }
      return declaredPackages;
    } else {
      console.log('Spring Boot default versions URL no longer exists.');
      return [];
    }
  }
  return [];
};

export const retrieveSimilarPomProperties = async (parsedPom, springBootVersion) => {
  const pomProperties = await getPomProperties(parsedPom);
  if (springBootVersion) {
    const defaultProperties = await getSpringBootProperties(springBootVersion);

    if (defaultProperties.length) {
      const declaredProperties = [];
      for (const pomProperty of pomProperties) {
        for (const defaultProperty of defaultProperties) {
          if (pomProperty === defaultProperty.property) {
            declaredProperties.push(pomProperty);
            break;
          }
        }
      }

      console.log('Declared Pom Properties Count -', declaredProperties.length);
      if (declaredProperties.length) {
        console.log('Declared Pom Properties -', declaredProperties);
      }
      return declaredProperties;
    } else {
      console.log('Spring Boot default versions URL no longer exists.');
      return [];
    }
  }
  return [];
};

const getSpringDefaultProperties = async (springBootVersion) => {
  try {
    await ensureDirExists();
    if (!existsSync(`${cachePath}/properties_${springBootVersion}.json`)) {
      await downloadSpringVersionProperties(springBootVersion);
      // } else {
      //     console.log('Spring Boot default properties file already exists in cache.');
    }
  } catch (err) {
    console.error('Error retrieving spring default properties', err);
  }
};

const replaceVariable = (properties, version) => {
  if (String(version).startsWith('${')) {
    const flatProperties = {};
    properties.forEach((property) => {
      for (const [key, value] of Object.entries(property)) {
        flatProperties[key] = value;
      }
    });
    const variableName = version.replace('${', '').replace('}', '');
    return flatProperties[variableName];
  }
  return version;
};

const downloadSpringVersionProperties = async (springBootVersion) => {
  let url = `https://docs.spring.io/spring-boot/docs/${springBootVersion}/reference/html/dependency-versions.html`;
  let bodyIndex = 1;
  let response = await fetch(url);
  // Handle new Spring Boot URL, count redirects as failures, and handle 3.3.+ gradle format
  if (response.status === 404 || response.url.includes('redirect.html')) {
    const springMinorVersion = springBootVersion.replace('.x', '');
    url = `https://docs.spring.io/spring-boot/${springMinorVersion}/appendix/dependency-versions/properties.html`;
    bodyIndex = 0;
    response = await fetch(url);
  }
  const versions = [];
  if (response.ok) {
    const template = await response.text();
    const parsedTemplate = parse(template);
    const tableBody = parsedTemplate.getElementsByTagName('tbody')[bodyIndex];

    // older versions of Spring Boot do not have property versions listed
    if (tableBody) {
      tableBody.childNodes.forEach(
        (
          child, // there's a header row we should skip
        ) =>
          child.childNodes.length === 0
            ? ''
            : versions.push({
                property: child.childNodes[3].rawText,
              }),
      );
    }
    await writeFileSync(`${cachePath}/properties_${springBootVersion}.json`, JSON.stringify(versions, null, 2));
  } else {
    await writeFileSync(`${cachePath}/properties_${springBootVersion}.json`, JSON.stringify(versions, null, 2));
    console.log('URL not found - Spring Boot default versions URL no longer exists.');
  }
};
