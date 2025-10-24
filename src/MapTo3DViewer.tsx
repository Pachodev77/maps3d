import React, { useState, useRef, useEffect } from 'react';
import { Upload, RotateCcw, Download } from 'lucide-react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function MapTo3DViewer() {
  const [image, setImage] = useState(null);
  const [heightScale, setHeightScale] = useState(50);
  const [segments, setSegments] = useState(400);
  const [invertHeight, setInvertHeight] = useState(false);
  const [removeText, setRemoveText] = useState(true);
  const [yPosition, setYPosition] = useState(0);

  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const meshRef = useRef(null);
  const animationRef = useRef(null);
  const controlsRef = useRef(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          setImage(img);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const getPixelInfo = (imageData, x, y, width) => {
    if (x < 0 || x >= width || y < 0 || y >= width) {
      return { r: 0, g: 0, b: 0, a: 0, feature: 'TERRAIN', rawHeight: 0 };
    }
    const index = (y * width + x) * 4;
    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const b = imageData.data[index + 2];
    const a = imageData.data[index + 3];
    const brightness = (r + g + b) / 3 / 255;
    const rawHeight = invertHeight ? 1 - brightness : brightness;

    if (removeText) {
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        if (a < 200 || (r > 220 && g < 80 && b < 80) || (g > 200 && r < 150 && b < 150 && (g - r) > 50) || (saturation > 130 && brightness > 150) || (r < 30 && g < 30 && b < 30)) {
            return { r, g, b, a, feature: 'TERRAIN', rawHeight: 0.05 };
        }

        const isRoad = (r, g, b) => {
          if (r > 200 && g > 150 && b < 130) return true;
          if (r > 210 && g > 210 && b > 210 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return true;
          return false;
        };

        if (isRoad(r, g, b)) {
            return { r, g, b, a, feature: 'ROAD', rawHeight };
        }

        const isBuilding = (r, g, b) => {
            const brightness = (r + g + b) / 3;
            const saturation = Math.max(r, g, b) - Math.min(r, g, b);
            if (brightness > 90 && brightness < 220 && saturation < 40) {
                return true;
            }
            return false;
        };

        if (isBuilding(r, g, b)) {
            return { r, g, b, a, feature: 'BUILDING', rawHeight };
        }
    }

    return { r, g, b, a, feature: 'TERRAIN', rawHeight };
  };

  useEffect(() => {
    if (!image || !canvasRef.current) return;

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = segments;
    tempCanvas.height = segments;
    tempCtx.drawImage(image, 0, 0, segments, segments);
    const imageData = tempCtx.getImageData(0, 0, segments, segments);

    // Pass 1: Generate raw height map and feature map
    const rawHeightMap = [];
    const featureMap = [];
    for (let i = 0; i < segments; i++) {
        rawHeightMap[i] = [];
        featureMap[i] = [];
        for (let j = 0; j < segments; j++) {
            const { rawHeight, feature } = getPixelInfo(imageData, j, i, segments);
            rawHeightMap[i][j] = rawHeight;
            featureMap[i][j] = feature;
        }
    }

    // Pass 2: Process maps to create final height map
    const finalHeightMap = [];
    for (let i = 0; i < segments; i++) {
        finalHeightMap[i] = [];
        for (let j = 0; j < segments; j++) {
            const feature = featureMap[i][j];
            const rawHeight = rawHeightMap[i][j];

            if (feature === 'ROAD') {
                finalHeightMap[i][j] = 0.05;
            } else if (feature === 'BUILDING') {
                let buildingNeighbors = 0;
                for (let ni = -1; ni <= 1; ni++) {
                    for (let nj = -1; nj <= 1; nj++) {
                        if (ni === 0 && nj === 0) continue;
                        const ni_abs = i + ni;
                        const nj_abs = j + nj;
                        if (ni_abs >= 0 && ni_abs < segments && nj_abs >= 0 && nj_abs < segments && featureMap[ni_abs][nj_abs] === 'BUILDING') {
                            buildingNeighbors++;
                        }
                    }
                }

                if (buildingNeighbors >= 5) { // Stricter core definition
                    finalHeightMap[i][j] = invertHeight ? 0.2 : 0.8;
                } else {
                    finalHeightMap[i][j] = invertHeight ? 0.4 : 0.6;
                }
            } else { // TERRAIN
                finalHeightMap[i][j] = rawHeight * 0.2;
            }
        }
    }
    
    if (sceneRef.current && meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) meshRef.current.material.dispose();
    }

    if (!sceneRef.current) {
      sceneRef.current = new THREE.Scene();
      sceneRef.current.background = new THREE.Color(0x1a1a2e);
    }

    if (!cameraRef.current) {
      cameraRef.current = new THREE.PerspectiveCamera(
        60,
        canvasRef.current.clientWidth / canvasRef.current.clientHeight,
        0.1,
        1000
      );
      cameraRef.current.position.set(150, 150, 150);
      cameraRef.current.lookAt(0, 0, 0);
    }

    if (!rendererRef.current) {
      rendererRef.current = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true
      });
      rendererRef.current.setSize(
        canvasRef.current.clientWidth,
        canvasRef.current.clientHeight
      );
    }

    if (!controlsRef.current) {
        controlsRef.current = new OrbitControls(cameraRef.current, rendererRef.current.domElement);
        controlsRef.current.enableDamping = true;
        controlsRef.current.dampingFactor = 0.05;
    }

    const geometry = new THREE.PlaneGeometry(200, 200, segments - 1, segments - 1);
    const vertices = geometry.attributes.position.array;

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < segments; j++) {
        const index = (i * segments + j) * 3;
        const height = finalHeightMap[i][j];
        vertices[index + 2] = height * heightScale;
      }
    }

    geometry.computeVertexNormals();

    const texture = new THREE.CanvasTexture(tempCanvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      wireframe: false,
      side: THREE.DoubleSide,
      flatShading: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    meshRef.current = mesh;
    sceneRef.current.add(mesh);

    if (!sceneRef.current.children.find(child => child.type === 'DirectionalLight')) {
      const light1 = new THREE.DirectionalLight(0xffffff, 1);
      light1.position.set(100, 100, 100);
      sceneRef.current.add(light1);

      const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
      light2.position.set(-100, 100, -100);
      sceneRef.current.add(light2);

      const ambientLight = new THREE.AmbientLight(0x404040, 1);
      sceneRef.current.add(ambientLight);
    }

    if (!sceneRef.current.children.find(child => child.type === 'GridHelper')) {
      const gridHelper = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
      gridHelper.position.y = -1;
      sceneRef.current.add(gridHelper);
    }

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [image, heightScale, segments, invertHeight, removeText]);

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.y = yPosition;
    }
  }, [yPosition]);

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const handleReset = () => {
    setImage(null);
    setHeightScale(50);
    setSegments(400);
    setInvertHeight(false);
    setRemoveText(true);
    setYPosition(0);

  };

  const exportToGLB = () => {
    if (!meshRef.current) return;

    const exporter = new GLTFExporter();
    
    // Crear una escena temporal solo con el mesh
    const exportScene = new THREE.Scene();
    const meshClone = meshRef.current.clone();
    exportScene.add(meshClone);
    
    exporter.parse(
      exportScene,
      (result) => {
        // Crear blob y descargar
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mapa-3d.glb';
        link.click();
        URL.revokeObjectURL(url);
      },
      (error) => {
        console.error('Error al exportar:', error);
        alert('Error al exportar el modelo');
      },
      { binary: true }
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Visor 3D de Mapas
          </h1>
          <p className="text-purple-200">
            Convierte imágenes de mapas en modelos 3D interactivos
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Panel de controles */}
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">Controles</h2>
            
            <div className="space-y-4">
              {!image ? (
                <label className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-purple-400 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                  <Upload className="w-12 h-12 text-purple-400 mb-2" />
                  <span className="text-purple-200">Cargar imagen de mapa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              ) : (
                <div>
                  <img
                    src={image.src}
                    alt="Mapa cargado"
                    className="w-full rounded-lg mb-4"
                  />
                  <div className="space-y-2">
                    <button
                      onClick={handleReset}
                      className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-200 py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                    >
                      <RotateCcw size={18} />
                      Resetear
                    </button>
                    <button
                      onClick={exportToGLB}
                      className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-200 py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                    >
                      <Download size={18} />
                      Descargar GLB
                    </button>
                  </div>
                </div>
              )}

              {image && (
                <>
                  <div>
                    <label className="text-white text-sm mb-2 block">
                      Escala de Altura: {heightScale}
                    </label>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={heightScale}
                      onChange={(e) => setHeightScale(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-purple-200 text-xs mt-1">
                      Negativo = invertir depresiones
                    </p>
                  </div>

                  <div>
                    <label className="text-white text-sm mb-2 block">
                      Resolución: {segments}x{segments}
                    </label>
                    <input
                      type="range"
                      min="100"
                      max="400"
                      step="10"
                      value={segments}
                      onChange={(e) => setSegments(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-purple-200 text-xs mt-1">
                      Mayor resolución = más detalle
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                    <label className="text-white text-sm">
                      Invertir Altura
                    </label>
                    <button
                      onClick={() => setInvertHeight(!invertHeight)}
                      className={`w-12 h-6 rounded-full transition-colors ${
                        invertHeight ? 'bg-purple-500' : 'bg-gray-600'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full transition-transform ${
                          invertHeight ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <label className="text-white text-sm mb-2 block">
                      Posición Y: {yPosition}
                    </label>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      step="1"
                      value={yPosition}
                      onChange={(e) => setYPosition(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-purple-200 text-xs mt-1">
                      Mover el modelo verticalmente
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                    <label className="text-white text-sm">
                      Filtrar Textos/Marcadores
                    </label>
                    <button
                      onClick={() => setRemoveText(!removeText)}
                      className={`w-12 h-6 rounded-full transition-colors ${
                        removeText ? 'bg-purple-500' : 'bg-gray-600'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full transition-transform ${
                          removeText ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <h3 className="text-white font-semibold mb-2 text-sm">💡 Consejos</h3>
              <ul className="text-purple-200 text-xs space-y-1">
                <li>• Usa mapas de calles o topográficos</li>
                <li>• Invierte altura para crear "valles"</li>
                <li>• Filtra textos para mejor geometría</li>
                <li>• Edificios = zonas claras/oscuras</li>
                <li>• Agua = azul, verde = parques</li>
              </ul>
            </div>
          </div>

          {/* Visor 3D */}
          <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">Vista 3D</h2>
            <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ height: '600px' }}>
              {!image ? (
                <div className="absolute inset-0 flex items-center justify-center text-purple-300">
                  <div className="text-center">
                    <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Carga una imagen para ver el modelo 3D</p>
                  </div>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="w-full h-full"
                  style={{ width: '100%', height: '100%' }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}