import React, { useState, useRef, useEffect } from 'react';
import { Upload, RotateCcw, Download } from 'lucide-react';
import * as THREE from 'three';

export default function MapTo3DViewer() {
  const [image, setImage] = useState(null);
  const [heightScale, setHeightScale] = useState(50);
  const [segments, setSegments] = useState(150);
  const [invertHeight, setInvertHeight] = useState(false);
  const [removeText, setRemoveText] = useState(true);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const meshRef = useRef(null);
  const animationRef = useRef(null);

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

  const getHeightFromImage = (imageData, x, y, width) => {
    const index = (y * width + x) * 4;
    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const b = imageData.data[index + 2];
    const a = imageData.data[index + 3];
    
    // Detectar y filtrar textos y marcadores
    if (removeText) {
      // Detectar transparencia o semi-transparencia (overlays de texto)
      if (a < 200) return 0.5;
      
      // Detectar blancos y grises claros (textos, etiquetas)
      if (r > 230 && g > 230 && b > 230) return 0.5;
      if (r > 200 && g > 200 && b > 200 && Math.abs(r-g) < 20 && Math.abs(g-b) < 20) return 0.5;
      
      // Detectar rojos puros (marcadores como hospitales, etc)
      if (r > 220 && g < 80 && b < 80) return 0.5;
      
      // Detectar amarillos/naranjas brillantes (carreteras destacadas)
      if (r > 220 && g > 160 && b < 120) {
        return 0.4; // Altura reducida para vías
      }
      
      // Detectar verdes brillantes saturados (marcadores de parques)
      if (g > 200 && r < 150 && b < 150 && (g - r) > 50) return 0.5;
      
      // Detectar colores muy saturados (iconos, símbolos)
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC - minC;
      const brightness = (r + g + b) / 3;
      
      // Alta saturación + brillo = probablemente un icono/marcador
      if (saturation > 130 && brightness > 150) return 0.5;
      
      // Detectar negros puros (bordes de texto, contornos)
      if (r < 30 && g < 30 && b < 30) return 0.5;
    }
    
    const brightness = (r + g + b) / 3 / 255;
    return invertHeight ? (1 - brightness) : brightness;
  };

  useEffect(() => {
    if (!image || !canvasRef.current) return;

    // Configurar canvas temporal para extraer datos de imagen
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = segments;
    tempCanvas.height = segments;
    tempCtx.drawImage(image, 0, 0, segments, segments);
    const imageData = tempCtx.getImageData(0, 0, segments, segments);

    // Limpiar escena anterior
    if (sceneRef.current && meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) meshRef.current.material.dispose();
    }

    // Configurar escena
    if (!sceneRef.current) {
      sceneRef.current = new THREE.Scene();
      sceneRef.current.background = new THREE.Color(0x1a1a2e);
    }

    // Configurar cámara
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

    // Configurar renderer
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

    // Crear geometría del terreno
    const geometry = new THREE.PlaneGeometry(200, 200, segments - 1, segments - 1);
    const vertices = geometry.attributes.position.array;

    // Aplicar altura basada en la imagen
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < segments; j++) {
        const index = (i * segments + j) * 3;
        const height = getHeightFromImage(imageData, j, i, segments);
        vertices[index + 2] = height * heightScale;
      }
    }

    geometry.computeVertexNormals();

    // Crear textura desde la imagen
    const texture = new THREE.CanvasTexture(tempCanvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    // Material con textura y wireframe opcional
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      wireframe: false,
      side: THREE.DoubleSide,
      flatShading: false
    });

    // Crear mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    meshRef.current = mesh;
    sceneRef.current.add(mesh);

    // Iluminación
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

    // Grid helper
    if (!sceneRef.current.children.find(child => child.type === 'GridHelper')) {
      const gridHelper = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
      gridHelper.position.y = -1;
      sceneRef.current.add(gridHelper);
    }

    // Animación
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      if (meshRef.current) {
        meshRef.current.rotation.z += 0.001;
      }
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
    setSegments(150);
    setInvertHeight(false);
    setRemoveText(true);
  };

  const exportToGLB = async () => {
    if (!meshRef.current || !sceneRef.current) return;

    try {
      // Importar GLTFExporter dinámicamente
      const { GLTFExporter } = await import('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/exporters/GLTFExporter.js');
      
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
    } catch (error) {
      console.error('Error al cargar el exportador:', error);
      alert('Error al cargar el exportador GLB');
    }
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
                      max="200"
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