import { cachePath, getDefaultSpringBootVersions, getJsonFromFile, Package } from './shared.js';
import { writeFileSync } from 'fs';
import { parse } from 'node-html-parser';

export const getComponents = async (filename) => {
    const parsedData = await getJsonFromFile(filename);
    return parsedData.components;
};

export const getSpringBootVersion = async (components) => {
    let springBoot = components.find(component => component.group === 'org.springframework.boot' && component.name === 'spring-boot');
    if (springBoot === undefined) {
        springBoot = components.find(component => component.name === 'spring-boot');
        if (springBoot === undefined) {
            console.log('No Spring Boot version found');
            return '';
        }
    }
    return springBoot.version;
};

export const retrieveSimilarSbomPackages = async (bomFile) => {
    const components = await getComponents(bomFile);
    const springBootVersion = await getSpringBootVersion(components);
    if (springBootVersion) {
        console.log('Detected Spring Boot Version', springBootVersion);
        const defaultVersions = await getDefaultSpringBootVersions(springBootVersion);

        if (defaultVersions.length) {
            const mismatchedPackages = [];
            components.forEach(bomPackage => defaultVersions.forEach(bootPackage => {
                if (bomPackage.group === bootPackage.group && bomPackage.name === bootPackage.name && bomPackage.version !== undefined && bomPackage.version !== bootPackage.version) {
                    const existingMatches = mismatchedPackages.find(mismatchedPackage => mismatchedPackage.group === bomPackage.group && mismatchedPackage.name === bomPackage.name && mismatchedPackage.sbomVersion === bomPackage.version && mismatchedPackage.bootVersion === bootPackage.version);
                    if (!existingMatches) {
                        mismatchedPackages.push(new Package(bomPackage.group, bomPackage.name, bomPackage.version, bootPackage.version));
                    }
                }
            }));

            console.log('Mismatched Package Count -', mismatchedPackages.length);
            console.log('Mismatched Packages', mismatchedPackages);
        } else {
            console.log('Spring Boot default versions URL no longer exists.');
        }
    }
};

const downloadSpringDefaultVersions = async (sbVersion) => {
    const response = await fetch(`https://docs.spring.io/spring-boot/docs/${sbVersion}/reference/html/dependency-versions.html`);
    const versions = [];
    switch (response.status) {
        // status "OK"
        case 200: {
            const template = await response.text();
            const parsedTemplate = parse(template);
            const tableBody = parsedTemplate.querySelector('table tbody');

            tableBody.childNodes.forEach(child => // there's a header row we should skip
                child.childNodes.length === 0 ? '' : versions.push({
                    group: child.childNodes[1].rawText,
                    name: child.childNodes[3].rawText,
                    version: child.childNodes[5].rawText,
                }));
            await writeFileSync(`${cachePath}/dependencies_${sbVersion}.json`, JSON.stringify(versions, null, 2));
            break;
        }
        case 404:
            await writeFileSync(`${cachePath}/dependencies_${sbVersion}.json`, JSON.stringify(versions, null, 2));
            console.log('URL not found - Spring Boot default versions URL no longer exists.');
            break;
    }
};